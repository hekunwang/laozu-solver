"""Build formal base/levels 0-3 plus an explicit prerelease level 4-5 overlay.

Run with an existing Python 3 environment; only the standard library is used.
No network, account state or game actions are used.
"""
import hashlib
import json
import re
from pathlib import Path
from catalog_sync import sync_catalog

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'


def read(name):
    return json.loads((DATA / (name + '.json')).read_text())


def write(name, value):
    (DATA / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    exported = read('export-manifest')
    version = exported['resourceVersion']
    assert exported['channel'] == 'formal'
    for name, record in exported['tables'].items():
        assert hashlib.sha256((DATA / (name + '.json')).read_bytes()).hexdigest() == record['jsonSha256'], name
    overlay = read('prerelease/manifest')
    assert overlay['channel'] == 'prerelease'
    for name, record in overlay['tables'].items():
        assert hashlib.sha256((DATA / 'prerelease' / (name + '.json')).read_bytes()).hexdigest() == record['jsonSha256'], name
    pre_effects = {x['iID']: x for x in read('prerelease/TeacherAwakenEffect')}
    pre_skills = {x['iID']: x for x in read('prerelease/WanderingEquipSkill')}
    catalog = read('original-catalog')
    teachers = {x['iID']: x for x in read('Teacher')}
    for equip in catalog['equips']:
        elder = equip.get('elder')
        if elder and elder['id'] in teachers:
            elder['name'] = teachers[elder['id']]['szName']
    effects = {x['iID']: x for x in read('TeacherAwakenEffect')}
    skills = {x['iID']: x for x in read('WanderingEquipSkill')}
    for sid in skills.keys() & pre_skills.keys():
        assert skills[sid] == pre_skills[sid], f'Cross-source raw skill conflict: {sid}'
    def decode_skill(sid, source=None):
        raw = (skills if source is None else source)[sid]
        assert raw['iType'] in (1005, 1006, 1007, 1008), raw
        assert not (raw['arrParam'] and raw['arrFlashParam']), raw
        values = raw['arrParam'] or raw['arrFlashParam']
        assert len(values) >= 3 and len(values) % 2 == 1, raw
        return {
            'id': sid, 'name': raw['szName'], 'desc': raw['szDesc'],
            'scope': 'self' if raw['iType'] in (1005, 1007) else 'adjacent',
            'elementMask': values[0],
            'buffs': [{'attr': values[i], 'value': values[i+1]}
                      for i in range(1, len(values), 2)],
        }
    # Existing skill IDs may have changed values in the new resource snapshot.
    changes = []
    for old in catalog['skills']:
        current = decode_skill(old['id'])
        if old['buffs'] != current['buffs']:
            changes.append({'id': old['id'], 'name': old['name'],
                            'old': old['buffs'], 'new': current['buffs']})
            for equip in catalog['equips']:
                if old['id'] not in equip['skillIds']:
                    continue
                for previous, updated in zip(old['buffs'], current['buffs']):
                    label = {2025: '伤害', 2005: '防御力'}.get(previous['attr'])
                    if label and previous['attr'] == updated['attr']:
                        equip['desc'] = equip['desc'].replace(
                            f"{label}+{previous['value']/100:g}%",
                            f"{label}+{updated['value']/100:g}%")
    catalog['skills'] = [decode_skill(s['id']) for s in catalog['skills']]
    write('official-skill-changes', changes)
    # Refresh all solver-consumed catalog fields, including low-quality talents.
    # Unsupported new shapes/equipment fail closed instead of silently staying stale.
    catalog = sync_catalog(catalog, {name: read(name) for name in exported['tables']})
    battle = {row['iSkillID']: row for row in read('BattleSkill')}
    equips = {row['iID']: row for row in read('WanderingEquip')}
    tips = {row['iID']: row for row in read('TextDesc')}
    for equip in catalog['equips']:
        raw = battle[equips[equip['id']]['iProvideSkill']]['szDesc']
        equip['desc'] = re.sub(r'<[^>]+>', '', raw)
        equip['tipIds'] = list(dict.fromkeys(int(v) for v in re.findall(r'tips_(\d+)', raw)))
    for tip in catalog['tips']:
        tip['desc'] = re.sub(r'<[^>]+>', '', tips[tip['id']]['szDetailDesc'])
    available_tips = {tip['id'] for tip in catalog['tips']}
    assert all(tip in available_tips for equip in catalog['equips'] for tip in equip['tipIds'])
    equip_ids = {x['id'] for x in catalog['equips']}
    awakening = {}
    skill_ids = {x['id'] for x in catalog['skills']}
    stages = [(r, effects, skills, 'formal') for r in read('TeacherAwakening')
              if 1 <= r['iAwakenLevel'] <= 3]
    stages += [(r, pre_effects, pre_skills, 'prerelease') for r in read('prerelease/TeacherAwakening')
               if 4 <= r['iAwakenLevel'] <= 5]
    # Retain the previously tested catalog insertion order while choosing each
    # stage's source explicitly. This avoids incidental skill-order changes.
    stage_order = {(r['iID'], r['iAwakenLevel']): i
                   for i, r in enumerate(read('prerelease/TeacherAwakening'))}
    stages.sort(key=lambda entry: stage_order[(entry[0]['iID'], entry[0]['iAwakenLevel'])])
    provenance = []
    for row, stage_effects, stage_skills, channel in stages:
        level, eid = row['iAwakenLevel'], row['iEquip']
        # Never import prerelease lower stages or formal 4/5 placeholders.
        if eid == 0 or row['iID'] not in teachers:
            continue
        assert eid in equip_ids, eid
        teacher = teachers[row['iID']]
        item = awakening.setdefault(str(eid), {
            'teacherId': row['iID'], 'teacherName': teacher['szName'],
            'maxLevel': 5, 'levels': {}, 'missingEffects': [],
        })
        assert item['teacherId'] == row['iID'], eid
        stage = {'baseBonus': {}, 'skillIds': None, 'globalBuffs': [],
                 'description': re.sub(r'<[^>]+>', '', row['szDes'])}
        for effect_id in row['arrAwakenEffect']:
            effect = stage_effects.get(effect_id)
            if effect is None:
                item['missingEffects'].append({'level': level, 'effectId': effect_id})
                item['maxLevel'] = min(item['maxLevel'], level - 1)
                continue
            kind, params = effect['iType'], effect['arrParam']
            if kind == 1:  # Inventory refund, no board attribute effect.
                continue
            if kind == 2:  # ReplaceAdjacent: highest active stage replaces list.
                assert stage['skillIds'] is None
                stage['skillIds'] = list(dict.fromkeys(params))
                for sid in params:
                    decoded = decode_skill(sid, stage_skills)
                    if sid in skill_ids:
                        existing = next(s for s in catalog['skills'] if s['id'] == sid)
                        assert existing == decoded, f'Cross-source skill conflict: {sid}'
                        continue
                    catalog['skills'].append(decoded)
                    skill_ids.add(sid)
            elif kind == 3:
                assert len(params) % 3 == 0
                for i in range(0, len(params), 3):
                    assert params[i] == 2 and params[i+1] in (2004, 2005, 2006)
                    attr = str(params[i+1] - 3)
                    stage['baseBonus'][attr] = stage['baseBonus'].get(attr, 0) + params[i+2]
            elif kind == 4:
                assert len(params) == 2
                for attr in (2004, 2005, 2006):
                    stage['globalBuffs'].append({'form': params[0], 'attr': attr,
                                               'value': params[1], 'excludeSource': True})
            elif kind == 5:
                assert channel == 'prerelease' and len(params) == 2 and 1 <= params[0] <= 8
                for attr in (2004, 2005, 2006):
                    stage['globalBuffs'].append({'element': params[0], 'attr': attr,
                                               'value': params[1], 'excludeSource': True})
            else:
                raise ValueError(f'Unsupported active awakening effect {effect}')
        assert str(level) not in item['levels'], f'Duplicate stage: {eid}/{level}'
        item['levels'][str(level)] = stage
        provenance.append({'equipId': eid, 'teacherId': row['iID'], 'level': level,
                           'channel': channel, 'effectIds': row['arrAwakenEffect']})
    for equip in catalog['equips']:
        if equip.get('elder') and str(equip['id']) not in awakening:
            awakening[str(equip['id'])] = {
                'teacherId': equip['elder']['id'], 'teacherName': equip['elder']['name'],
                'maxLevel': 0, 'levels': {},
                'missingEffects': [{'level': 1, 'effectId': '官方快照未配置觉醒'}],
            }
    assert len(awakening) == 80
    assert sum(x['maxLevel'] == 5 for x in awakening.values()) == 78
    assert all(set(x['levels']) == {'1','2','3','4','5'} for x in awakening.values() if x['maxLevel'] == 5)
    assert len(catalog['talents']) == 40 and all(x['quality'] >= 2 for x in catalog['talents'])
    attrs = {x['id'] for x in catalog['attrs']}
    assert all(b['attr'] in attrs for sk in catalog['skills'] for b in sk['buffs'])
    catalog['meta'].update(resourceVersion=version + ' 正式配置 + ' + overlay['resourceVersion'] + ' 四五觉预适配', extractedAt='2026-10-13',
                           skillCount=len(catalog['skills']),
                           awakeningCount=sum(x['maxLevel'] == 5 for x in awakening.values()),
                           awakeningTotal=len(awakening))
    write('awakening', awakening)
    write('game-catalog', catalog)
    manifest = {
        'resourceVersion': version, 'channel': 'formal-with-prerelease-awakening45', 'builtForDate': '2026-10-13',
        'formalBaseVersion': version, 'prereleaseAwakening45Version': overlay['resourceVersion'],
        'levelSources': {'0-3': 'formal', '4-5': 'prerelease'},
        'prereleaseSourceHashes': {name + '.json': record['jsonSha256'] for name, record in overlay['tables'].items()},
        'upstream': 'https://github.com/fradwow/laozu-solver',
        'sourceSnapshot': exported['source'],
        'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted(DATA.glob('*.json'))
                         if p.stem in exported['tables']},
        'counts': {'equips': len(catalog['equips']), 'skills': len(catalog['skills']),
                   'awakeningComplete': sum(x['maxLevel'] == 5 for x in awakening.values()),
                   'awakeningTotal': len(awakening), 'talents': len(catalog['talents']),
                   'scoreTiers': len(catalog['scoreTiers'])},
        'missing': {k: v['missingEffects'] for k, v in awakening.items() if v['missingEffects']},
        'notes': ['原版形状修正与截图识别模板保留', '缺失的官方效果不会猜补',
                  '基础配置与0–3觉按正式资源；4–5觉为先遣资源预适配，未宣称正式服运行验证',
                  '只优化法宝属性战力，不模拟战斗或证明全局最优'],
    }
    write('manifest', manifest)
    write('awakening-source-composition', {'formalVersion': version,
          'prereleaseVersion': overlay['resourceVersion'], 'stages': provenance})
    print(json.dumps(manifest['counts'], ensure_ascii=False))
    print('Missing official effects:', manifest['missing'])


if __name__ == '__main__':
    main()
