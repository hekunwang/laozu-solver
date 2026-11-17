"""Build the catalog and all awakening levels from one formal resource snapshot.

Run with an existing Python 3 environment; only the standard library is used.
No network, account state or game actions are used.
"""
import hashlib
import json
import re
import sys
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
    channel = exported['channel']
    preview = channel == 'prerelease'
    assert channel in ('formal', 'prerelease')
    assert not preview or ('--local-preview' in sys.argv and exported.get('localOnly') is True)
    assert not preview or version == '2610152238'
    expected = exported.get('expectedCounts', {'awakeningStages': 400 if preview else 390, 'awakeningTotal': 82 if preview else 80, 'awakeningComplete': 80 if preview else 78})
    expected_stages, expected_total, expected_complete = (expected[k] for k in ('awakeningStages', 'awakeningTotal', 'awakeningComplete'))
    date = exported.get('builtForDate', '2026-10-15')
    for name, record in exported['tables'].items():
        assert hashlib.sha256((DATA / (name + '.json')).read_bytes()).hexdigest() == record['jsonSha256'], name
    catalog = read('original-catalog')
    teachers = {x['iID']: x for x in read('Teacher')}
    for equip in catalog['equips']:
        elder = equip.get('elder')
        if elder and elder['id'] in teachers:
            elder['name'] = teachers[elder['id']]['szName']
    effects = {x['iID']: x for x in read('TeacherAwakenEffect')}
    skills = {x['iID']: x for x in read('WanderingEquipSkill')}
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
    # Preserve all three distinct effect channels; global disciple effects must
    # never be implicitly multiplied by the number of equipped treasures.
    acquired = []
    for row in read('AcquiredAbility'):
        if row['iID'] <= 0:
            continue
        def pairs(field):
            values = row[field]
            assert len(values) % 2 == 0, (row['iID'], field)
            return [{'attr': values[i], 'value': values[i + 1]}
                    for i in range(0, len(values), 2)]
        acquired.append({'id': row['iID'], 'name': row['szName'], 'desc': row['szDesc'],
                         'quality': row['iQuality'], 'forms': row['arrWeaponForm'],
                         'effects': pairs('arrEffect'),
                         'equipBaseEffects': pairs('arrEffectEquip1'),
                         'equipAdvancedEffects': pairs('arrEffectEquip2')})
    assert len(acquired) == 193 and len({r['id'] for r in acquired}) == 193
    catalog['acquiredTalents'] = sorted(acquired, key=lambda r: r['id'])
    write('acquired-talents', catalog['acquiredTalents'])
    attribute_rows = {r['iAtrributeID']: r for r in read('Attribute') if r['iAtrributeID'] > 0}
    attr_ids = {a['id'] for a in catalog['attrs']}
    for effect in (e for talent in acquired for e in talent['equipAdvancedEffects']):
        if effect['attr'] not in attr_ids:
            raw = attribute_rows[effect['attr']]
            catalog['attrs'].append({'id': effect['attr'], 'name': raw['szAttrName'],
                                     'kind': raw['iAttrType'], 'nPower': raw['nPower']})
            attr_ids.add(effect['attr'])
    battle = {row['iSkillID']: row for row in read('BattleSkill')}
    equips = {row['iID']: row for row in read('WanderingEquip')}
    tips = {row['iID']: row for row in read('TextDesc')}
    tip_names = {}
    for equip in catalog['equips']:
        raw = battle[equips[equip['id']]['iProvideSkill']]['szDesc']
        for tip_id, label in re.findall(r'<link="tips_(\d+)">([^<]+)</link>', raw):
            tip_names.setdefault(int(tip_id), label)
        equip['desc'] = re.sub(r'<[^>]+>', '', raw)
        equip['tipIds'] = list(dict.fromkeys(int(v) for v in re.findall(r'tips_(\d+)', raw)))
    existing_tips = {tip['id'] for tip in catalog['tips']}
    for tip_id in sorted({i for equip in catalog['equips'] for i in equip['tipIds']} - existing_tips):
        assert tip_id in tip_names, tip_id
        catalog['tips'].append({'id': tip_id, 'name': tip_names[tip_id], 'desc': ''})
    for tip in catalog['tips']:
        tip['desc'] = re.sub(r'<[^>]+>', '', tips[tip['id']]['szDetailDesc'])
    available_tips = {tip['id'] for tip in catalog['tips']}
    assert all(tip in available_tips for equip in catalog['equips'] for tip in equip['tipIds'])
    equip_ids = {x['id'] for x in catalog['equips']}
    awakening = {}
    skill_ids = {x['id'] for x in catalog['skills']}
    stages = [(r, effects, skills, channel) for r in read('TeacherAwakening')
              if 1 <= r['iAwakenLevel'] <= 5 and r['iEquip'] != 0 and r['iID'] in teachers]
    # Preserve accepted insertion/skill order without using historical overlay
    # content as a data source. This file contains ordering keys only.
    order = read('awakening-stage-order')['stages']
    stage_order = {tuple(key): i for i, key in enumerate(order)}
    assert len(stage_order) == len(order) == expected_stages
    assert {(r['iID'], r['iAwakenLevel']) for r, _, _, _ in stages} == set(stage_order)
    stages.sort(key=lambda entry: stage_order[(entry[0]['iID'], entry[0]['iAwakenLevel'])])
    provenance = []
    for row, stage_effects, stage_skills, channel in stages:
        level, eid = row['iAwakenLevel'], row['iEquip']
        # All active levels, including 4/5, use the same verified formal source.
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
                assert channel in ('formal', 'prerelease') and len(params) == 2 and 1 <= params[0] <= 8
                for attr in (2004, 2005, 2006):
                    stage['globalBuffs'].append({'element': params[0], 'attr': attr,
                                               'value': params[1], 'excludeSource': True})
            else:
                raise ValueError(f'Unsupported active awakening effect {effect}')
        assert str(level) not in item['levels'], f'Duplicate stage: {eid}/{level}'
        item['levels'][str(level)] = stage
        provenance.append({'equipId': eid, 'teacherId': row['iID'], 'level': level,
                           'channel': channel, 'resourceVersion': version,
                           'effectIds': row['arrAwakenEffect']})
    for equip in catalog['equips']:
        if equip.get('elder') and str(equip['id']) not in awakening:
            awakening[str(equip['id'])] = {
                'teacherId': equip['elder']['id'], 'teacherName': equip['elder']['name'],
                'maxLevel': 0, 'levels': {},
                'missingEffects': [{'level': 1, 'effectId': '官方快照未配置觉醒'}],
            }
    if preview:
        # Original decoded rows remain untouched. This is a separately recorded
        # user-selected interpretation, not a claim of server verification.
        policy = read('rule-overrides')
        assert policy['officialRuntimeVerified'] is False
        assert len(policy['overrides']) == 1
        rule = policy['overrides'][0]
        assert rule == {'equipId': 250703, 'level': 5, 'effectId': 3534,
                       'rawSkillIds': [71001, 71002, 71003], 'skillIds': [71001, 71003],
                       'adjacentPercent': 15, 'meaning': 'Five-awakening 15% replaces the earlier 8%, not additive'}
        stage = awakening['250703']['levels']['5']
        assert stage['skillIds'] == rule['rawSkillIds']
        stage['skillIds'] = rule['skillIds']
        awakening['250703']['ruleOverride'] = {**rule, 'source': policy['source'], 'officialRuntimeVerified': False}
    assert len(awakening) == expected_total
    assert sum(x['maxLevel'] == 5 for x in awakening.values()) == expected_complete
    assert all(set(x['levels']) == {'1','2','3','4','5'} for x in awakening.values() if x['maxLevel'] == 5)
    assert len(catalog['talents']) == 42 and all(x['quality'] >= 2 for x in catalog['talents'])
    attrs = {x['id'] for x in catalog['attrs']}
    assert all(b['attr'] in attrs for sk in catalog['skills'] for b in sk['buffs'])
    assert len(provenance) == expected_stages and all(row['channel'] == channel for row in provenance)
    catalog['meta'].update(resourceVersion=version + (' 先遣本地验证配置' if preview else ' 正式配置（含四五觉）'), extractedAt=date,
                           skillCount=len(catalog['skills']),
                           awakeningCount=sum(x['maxLevel'] == 5 for x in awakening.values()),
                           awakeningTotal=len(awakening))
    assert len(catalog['equips']) == expected.get('equips', len(catalog['equips']))
    assert len(catalog['skills']) == expected.get('skills', len(catalog['skills']))
    write('awakening', awakening)
    write('game-catalog', catalog)
    manifest = {
        'resourceVersion': version, 'channel': channel, 'localOnly': bool(exported.get('localOnly', preview)), 'builtForDate': date,
        'formalBaseVersion': exported.get('formalBaseVersion', version),
        'levelSources': {'0-5': channel},
        'upstream': 'https://github.com/fradwow/laozu-solver',
        'sourceSnapshot': exported['source'],
        'sourceEvidence': exported['sourceEvidence'],
        'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted(DATA.glob('*.json'))
                         if p.stem in exported['tables']},
        'counts': {'equips': len(catalog['equips']), 'skills': len(catalog['skills']),
                   'awakeningComplete': sum(x['maxLevel'] == 5 for x in awakening.values()),
                   'awakeningConfigured': sum(len(x['levels']) == 5 for x in awakening.values()),
                   'awakeningTotal': len(awakening), 'talents': len(catalog['talents']),
                   'scoreTiers': len(catalog['scoreTiers'])},
        'missing': {k: v['missingEffects'] for k, v in awakening.items() if v['missingEffects']},
        'ruleOverrides': read('rule-overrides') if preview else None,
        'recognitionPendingEquipIds': [250703, 250704] if preview else [250405, 250406],
        'notes': ['原版形状修正与截图识别模板保留', '缺失的官方效果不会猜补',
                  ('先遣本地验证：八风五觉按用户指定15%替换8%，非官服实测确认；新宝截图外观样本待补' if preview else '基础配置及0–5觉均同步正式资源；已核对公开正式客户端配置，未宣称实战运行验证'),
                  '只优化法宝属性战力，不模拟战斗或证明全局最优'],
    }
    write('manifest', manifest)
    write('awakening-source-composition', {'resourceVersion': version, 'formalVersion': exported.get('formalBaseVersion', version),
          'channel': channel, 'stages': provenance})
    print(json.dumps(manifest['counts'], ensure_ascii=False))
    print('Missing official effects:', manifest['missing'])


if __name__ == '__main__':
    main()
