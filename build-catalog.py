"""Build the local catalog from exported official 2609241624 tables.

Run with an existing Python 3 environment; only the standard library is used.
No network, account state or game actions are used.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'


def read(name):
    return json.loads((DATA / (name + '.json')).read_text())


def write(name, value):
    (DATA / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    catalog = read('original-catalog')
    teachers = {x['iID']: x for x in read('Teacher')}
    for equip in catalog['equips']:
        elder = equip.get('elder')
        if elder and elder['id'] in teachers:
            elder['name'] = teachers[elder['id']]['szName']
    effects = {x['iID']: x for x in read('TeacherAwakenEffect')}
    skills = {x['iID']: x for x in read('WanderingEquipSkill')}
    def decode_skill(sid):
        raw = skills[sid]
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
    equip_ids = {x['id'] for x in catalog['equips']}
    awakening = {}
    skill_ids = {x['id'] for x in catalog['skills']}
    for row in read('TeacherAwakening'):
        level, eid = row['iAwakenLevel'], row['iEquip']
        # Levels 4 and 5 are explicitly labelled 敬请期待 in this snapshot.
        if level > 3 or eid == 0:
            continue
        assert eid in equip_ids, eid
        teacher = teachers[row['iID']]
        item = awakening.setdefault(str(eid), {
            'teacherId': row['iID'], 'teacherName': teacher['szName'],
            'maxLevel': 3, 'levels': {}, 'missingEffects': [],
        })
        assert item['teacherId'] == row['iID'], eid
        stage = {'baseBonus': {}, 'skillIds': None, 'globalBuffs': [],
                 'description': re.sub(r'<[^>]+>', '', row['szDes'])}
        for effect_id in row['arrAwakenEffect']:
            effect = effects.get(effect_id)
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
                    if sid in skill_ids:
                        continue
                    catalog['skills'].append(decode_skill(sid))
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
            else:
                raise ValueError(f'Unsupported active awakening effect {effect}')
        item['levels'][str(level)] = stage
    for equip in catalog['equips']:
        if equip.get('elder') and str(equip['id']) not in awakening:
            awakening[str(equip['id'])] = {
                'teacherId': equip['elder']['id'], 'teacherName': equip['elder']['name'],
                'maxLevel': 0, 'levels': {},
                'missingEffects': [{'level': 1, 'effectId': '官方快照未配置觉醒'}],
            }
    assert len(awakening) == 80
    attrs = {x['id'] for x in catalog['attrs']}
    assert all(b['attr'] in attrs for sk in catalog['skills'] for b in sk['buffs'])
    catalog['meta'].update(resourceVersion='2609241624 · 本地觉醒版', extractedAt='2026-10-02',
                           skillCount=len(catalog['skills']),
                           awakeningCount=sum(x['maxLevel'] == 3 for x in awakening.values()),
                           awakeningTotal=len(awakening))
    write('awakening', awakening)
    write('game-catalog', catalog)
    manifest = {
        'resourceVersion': '2609241624', 'builtForDate': '2026-10-02',
        'upstream': 'https://github.com/fradwow/laozu-solver',
        'sourceSnapshot': 'live-2609241624-daily',
        'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted(DATA.glob('*.json'))
                         if p.stem in ('Teacher', 'TeacherAwakening', 'TeacherAwakenEffect',
                                       'WanderingEquip', 'WanderingEquipSkill', 'Attribute')},
        'counts': {'equips': len(catalog['equips']), 'skills': len(catalog['skills']),
                   'awakeningComplete': sum(x['maxLevel'] == 3 for x in awakening.values()),
                   'awakeningTotal': len(awakening)},
        'missing': {k: v['missingEffects'] for k, v in awakening.items() if v['missingEffects']},
        'notes': ['原版形状修正与截图识别模板保留', '缺失的官方效果不会猜补',
                  '只优化法宝属性战力，不模拟战斗或证明全局最优'],
    }
    write('manifest', manifest)
    print(json.dumps(manifest['counts'], ensure_ascii=False))
    print('Missing official effects:', manifest['missing'])


if __name__ == '__main__':
    main()
