"""Synchronize supported solver catalog fields from frozen formal raw tables.

No I/O, network, game access, version selection or product mutation occurs here.
The caller supplies decoded tables from one verified snapshot. Combat prose and
tip links are intentionally left to the caller's BattleSkill/TextDesc pipeline.
"""
from copy import deepcopy

SOURCE_TABLES = (
    'WanderingEquip', 'WanderingEquipSlot', 'WanderingEquipSkill',
    'Teacher', 'WanderingEquipCompose', 'Attribute', 'Ability', 'WanderScore',
)
PROTECTED_SHAPES = {
    20110: [[0, 1], [1, 1], [2, 1], [3, 0], [3, 1]],
    20312: [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
}


def _rows(tables, name):
    rows = tables.get(name)
    if not isinstance(rows, (list, tuple)) or not rows:
        raise ValueError('Missing or empty decoded source table: ' + name)
    return rows


def _index(rows, key, name):
    out = {}
    for row in rows:
        value = row[key]
        if value in out:
            raise ValueError(f'Duplicate {name}.{key}: {value}')
        out[value] = row
    return out


def _pairs(values, label):
    if len(values) % 2:
        raise ValueError('Odd parameter list: ' + label)
    return list(zip(values[::2], values[1::2]))


def _single(values, label):
    if len(values) > 1:
        raise ValueError('Multiple values require explicit model support: ' + label)
    return values[0] if values else 0


def _primary_form(row):
    values = row['arrWeaponForm']
    # The released catalog models the primary form. The sole existing secondary
    # tag is 金箍棒 [枪=6, 棍=10]. No equipment talent or active awakening
    # mapping uses form 10 in this snapshot (unreferenced aura 4310 exists).
    if row['iID'] == 250104 and values == [6, 10]:
        return 6
    return _single(values, 'weapon form of ' + str(row['iID']))


def _shape(row):
    # Translation only. Do not rotate, reflect, or infer cells from absorb masks.
    cells = [[r, c] for r in range(6)
             for c, value in enumerate(row['arrEmitRow' + str(r)]) if value]
    if not cells:
        raise ValueError('Empty source shape: ' + str(row['iLayoutID']))
    min_r, min_c = min(x[0] for x in cells), min(x[1] for x in cells)
    cells = [[r - min_r, c - min_c] for r, c in cells]
    return {'id': row['iLayoutID'], 'name': row['szName'], 'cells': cells,
            'width': max(x[1] for x in cells) + 1,
            'height': max(x[0] for x in cells) + 1}


def _skill(row):
    if row['iType'] not in (1005, 1006, 1007, 1008):
        raise ValueError('Unsupported equipment skill type: ' + str(row['iID']))
    if row['arrParam'] and row['arrFlashParam']:
        raise ValueError('Two simultaneous skill channels: ' + str(row['iID']))
    values = row['arrParam'] or row['arrFlashParam']
    if len(values) < 3:
        raise ValueError('Empty equipment skill: ' + str(row['iID']))
    return {'id': row['iID'], 'name': row['szName'], 'desc': row['szDesc'],
            'scope': 'self' if row['iType'] in (1005, 1007) else 'adjacent',
            'elementMask': values[0],
            'buffs': [{'attr': a, 'value': v}
                      for a, v in _pairs(values[1:], 'skill ' + str(row['iID']))]}


def sync_catalog(catalog, tables):
    """Return a synchronized deep copy. Do not mutate catalog or raw tables.

    Existing equipment/shape coverage must match the current supported range;
    new or removed equipment requires an explicit UI/recognizer coverage review.
    Type-1 inventory/storage placeholders are deliberately excluded.
    """
    for name in SOURCE_TABLES:
        _rows(tables, name)
    out = deepcopy(catalog)
    equip_raw = _index(tables['WanderingEquip'], 'iID', 'WanderingEquip')
    shape_raw = _index(tables['WanderingEquipSlot'], 'iLayoutID', 'WanderingEquipSlot')
    skill_raw = _index(tables['WanderingEquipSkill'], 'iID', 'WanderingEquipSkill')
    teacher_raw = _index(tables['Teacher'], 'iID', 'Teacher')
    compose_raw = _index(tables['WanderingEquipCompose'], 'iFormID', 'WanderingEquipCompose')
    # The official table contains duplicate blank ID-0 records; those are not
    # attributes and must not hide a duplicate real attribute ID.
    attr_raw = _index([r for r in tables['Attribute'] if r['iAtrributeID'] > 0],
                      'iAtrributeID', 'Attribute')
    known_ids = {x['id'] for x in out['equips']}
    usable_ids = {x['iID'] for x in tables['WanderingEquip'] if x['iType'] == 0}
    if known_ids != usable_ids:
        raise ValueError(f'Equipment coverage changed; new={sorted(usable_ids-known_ids)}, '
                         f'removed={sorted(known_ids-usable_ids)}')
    if any(x['iType'] not in (0, 1) for x in tables['WanderingEquip']):
        raise ValueError('Unknown equipment category requires review')

    teachers_by_equip = {}
    for teacher in teacher_raw.values():
        for compose_id in teacher['arrComposeID']:
            if compose_id not in compose_raw:
                raise ValueError('Missing teacher recipe: ' + str(compose_id))
            for equip_id in compose_raw[compose_id]['arrProductID']:
                if equip_id not in known_ids or equip_raw[equip_id]['iQuality'] != 5:
                    continue
                previous = teachers_by_equip.get(equip_id)
                if previous is not None and previous['iID'] != teacher['iID']:
                    raise ValueError('Ambiguous teacher mapping: ' + str(equip_id))
                teachers_by_equip[equip_id] = teacher

    for equip in out['equips']:
        raw = equip_raw[equip['id']]
        equip.update(name=raw['szName'], element=_single(raw['arrTechnique'], 'element'),
                     tier=raw['iStar'], quality=raw['iQuality'],
                     weaponForm=_primary_form(raw),
                     shapeId=raw['iSlotId'],
                     base=[{'attr': a, 'value': v}
                           for a, v in _pairs(raw['arrBuffParam'], 'equipment base')],
                     skillIds=list(raw['arrSkillID']), reson=raw['iReson'],
                     power=raw['iPower'], groupId=raw['iGroupId'],
                     feature=raw['szEquipFeature'])
        teacher = teachers_by_equip.get(equip['id'])
        if teacher is None:
            if 'elder' in equip:
                raise ValueError('Previously linked teacher missing: ' + str(equip['id']))
        else:
            bonus = []
            for level, value in _pairs(teacher['arrStarAffect1'], 'teacher stars'):
                if level % 6 or not 1 <= level // 6 <= 5:
                    raise ValueError('Unsupported star threshold: ' + str(level))
                bonus.append([level // 6, value])
            equip['elder'] = {'id': teacher['iID'], 'name': teacher['szName'],
                              'quality': teacher['iQuality'], 'starBonus': bonus}

    normalized = []
    for previous in out['shapes']:
        shape = _shape(shape_raw[previous['id']])
        expected = PROTECTED_SHAPES.get(shape['id'])
        if expected is not None:
            if shape['cells'] != expected or previous['cells'] != expected:
                raise ValueError('Protected corrected shape changed: ' + str(shape['id']))
        normalized.append(shape)
    out['shapes'] = normalized
    supported_shapes = {x['id'] for x in normalized}
    if any(x['shapeId'] not in supported_shapes for x in out['equips']):
        raise ValueError('Equipment references an unsupported shape')

    # Keep all existing awakening skills and add any newly referenced base skill.
    skill_ids = [x['id'] for x in out['skills']]
    for equip in out['equips']:
        for skill_id in equip['skillIds']:
            if skill_id not in skill_ids:
                skill_ids.append(skill_id)
    out['skills'] = [_skill(skill_raw[skill_id]) for skill_id in skill_ids]

    attr_ids = [x['id'] for x in out['attrs']]
    for item in [b for e in out['equips'] for b in e['base']] + [b for s in out['skills'] for b in s['buffs']]:
        if item['attr'] not in attr_ids:
            attr_ids.append(item['attr'])
    out['attrs'] = [{'id': i, 'name': attr_raw[i]['szAttrName'],
                     'kind': attr_raw[i]['iAttrType'], 'nPower': attr_raw[i]['nPower']}
                    for i in attr_ids]

    talents = []
    for raw in tables['Ability']:
        # Explicit user scope: white quality-1 talents do not appear in their
        # use case and must not be added. Keep the existing quality>=2 range.
        if raw['iLevel'] != 0 or raw['iType'] != 4 or raw['iQuality'] < 2 or not raw['iWeaponForm'] or not raw['arrEffectEquip']:
            continue
        values = raw['arrEffectEquip']
        if len(values) != 2 or values[0] not in (2004, 2005, 2006):
            raise ValueError('Unsupported weapon talent: ' + str(raw['iAbilityID']))
        talents.append({'id': raw['iAbilityID'], 'name': raw['szName'], 'desc': raw['szDesc'],
                        'quality': raw['iQuality'], 'form': raw['iWeaponForm'],
                        'attr': values[0], 'value': values[1]})
    _index(talents, 'id', 'weapon talents')
    out['talents'] = sorted(talents, key=lambda x: x['id'])

    _index(tables['WanderScore'], 'nID', 'WanderScore')
    out['scoreTiers'] = [
        {'id': r['nID'], 'name': r['szDesc'], 'min': r['iLowerLimit'],
         'max': r['iUpperLimit'], 'sectProgress': r['iSectProgress'],
         'rewardNum': r['iRewardNum'], 'adventureBonus': r['iAdventureBonus'],
         'farmDefender': r['iFarmDefenderIncome'], 'farmThief': r['iFarmThiefIncome'],
         'mineBoost': list(r['arrMineItemBoost'])}
        for r in sorted(tables['WanderScore'], key=lambda x: x['nID'])]
    out['meta'].update(equipCount=len(out['equips']), shapeCount=len(out['shapes']),
                       skillCount=len(out['skills']))
    return out


def audit_catalog(catalog, tables):
    """Return structured field differences without writing or mutating anything."""
    expected = sync_catalog(catalog, tables)
    differences = {}
    for section in ('equips', 'shapes', 'skills', 'attrs', 'talents', 'scoreTiers'):
        before = {x['id']: x for x in catalog[section]}
        after = {x['id']: x for x in expected[section]}
        differences[section] = {
            'beforeCount': len(before), 'afterCount': len(after),
            'addedIds': sorted(after.keys() - before.keys()),
            'removedIds': sorted(before.keys() - after.keys()),
            'changed': [{'id': i, 'fields': [k for k in after[i]
                                          if before[i].get(k) != after[i][k]]}
                        for i in sorted(before.keys() & after.keys()) if before[i] != after[i]],
        }
    differences['excludedEquipment'] = [
        {'id': r['iID'], 'name': r['szName'], 'iType': r['iType'],
         'reason': 'Inventory/storage grid placeholder, not a treasure'}
        for r in tables['WanderingEquip'] if r['iType'] == 1]
    differences['shapeRule'] = 'Translate nonzero arrEmitRow cells only; never rotate or reflect'
    differences['protectedShapes'] = sorted(PROTECTED_SHAPES)
    differences['scoreTiersConsumedByRuntime'] = False
    differences['excludedWhiteTalents'] = [
        {'id': r['iAbilityID'], 'name': r['szName'],
         'reason': 'Explicit user exclusion: do not add white quality-1 talents'}
        for r in tables['Ability'] if r['iLevel'] == 0 and r['iType'] == 4
        and r['iQuality'] == 1 and r['iWeaponForm'] and r['arrEffectEquip']]
    differences['primaryFormOnly'] = [{'equipId': 250104, 'rawForms': [6, 10], 'catalogForm': 6,
                                      'note': 'Preserve released primary-form model; form-10 aura 4310 exists but has no TeacherAwakening reference; no form-10 equipment talent'}]
    return differences
