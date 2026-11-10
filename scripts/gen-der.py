"""Generates docs/DER.md (Mermaid erDiagram) from supabase/migrations/*.sql.

    python scripts/gen-der.py

Reads every CREATE TABLE / ALTER TABLE / CREATE TYPE ... AS ENUM in migration order, so
the diagram is what a fresh `supabase db reset` would build. No database needed.
Rerun it in any PR that adds a migration touching tables.
"""
import glob, os, re, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
files = sorted(glob.glob(os.path.join(root, 'supabase', 'migrations', '*.sql')))

def statements(sql):
    out, buf, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i); i = n if j < 0 else j; continue
        if sql.startswith('/*', i):
            j = sql.find('*/', i); i = n if j < 0 else j + 2; continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j+1:j+2] == "'": j += 2; continue
                if sql[j] == "'": break
                j += 1
            buf.append(sql[i:j+1]); i = j + 1; continue
        m = re.match(r'\$[A-Za-z_]*\$', sql[i:])
        if m:
            tag = m.group(0); j = sql.find(tag, i + len(tag))
            buf.append(' $$BODY$$ '); i = j + len(tag); continue
        if c == ';':
            out.append(''.join(buf).strip()); buf = []; i += 1; continue
        buf.append(c); i += 1
    if ''.join(buf).strip(): out.append(''.join(buf).strip())
    return out

def split_top(s):
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(cur).strip()); cur = []
        else: cur.append(ch)
    if ''.join(cur).strip(): parts.append(''.join(cur).strip())
    return parts

def qn(name):
    name = name.replace('"', '').lower()
    return name if '.' in name else 'public.' + name

STOP = {'not', 'null', 'default', 'primary', 'references', 'unique', 'check', 'generated', 'constraint', 'collate'}
enums = {}
tables = {}  # name -> {cols: {name: {type, pk, fk, nn, uq}}, order: [...]}

def parse_col(defn):
    toks = re.findall(r'"[^"]+"|\w+(?:\.\w+)*(?:\[\])?|\([^()]*(?:\([^()]*\)[^()]*)*\)|\S', defn)
    name = toks[0].replace('"', '').lower()
    typ = []
    k = 1
    while k < len(toks) and toks[k].lower() not in STOP:
        typ.append(toks[k]); k += 1
    low = defn.lower()
    fk = None
    m = re.search(r'references\s+([\w."]+)\s*(\(\s*(\w+)\s*\))?', low)
    if m: fk = (qn(m.group(1)), m.group(3) or 'id')
    t = ''.join(x if x.startswith('(') or x == '[]' else ' ' + x for x in typ).strip()
    t = re.sub(r'\s+', ' ', t).lower().replace('public.', '')
    return name, {'type': t, 'pk': 'primary key' in low, 'fk': fk, 'nn': 'not null' in low or 'primary key' in low,
                  'uq': bool(re.search(r'\bunique\b', low))}

def table_constraint(tbl, c):
    low = c.lower()
    low = re.sub(r'^constraint\s+\S+\s+', '', low)
    m = re.match(r'primary key\s*\(([^)]*)\)', low)
    if m:
        for col in [x.strip().replace('"', '') for x in m.group(1).split(',')]:
            if col in tbl['cols']: tbl['cols'][col]['pk'] = True; tbl['cols'][col]['nn'] = True
        return
    m = re.match(r'foreign key\s*\(([^)]*)\)\s*references\s+([\w."]+)\s*(\(([^)]*)\))?', low)
    if m:
        cols = [x.strip().replace('"', '') for x in m.group(1).split(',')]
        refc = [x.strip() for x in (m.group(4) or 'id').split(',')]
        for col, rc in zip(cols, refc):
            if col in tbl['cols']: tbl['cols'][col]['fk'] = (qn(m.group(2)), rc)
        return
    m = re.match(r'unique\s*\(([^)]*)\)', low)
    if m:
        cols = [x.strip().replace('"', '') for x in m.group(1).split(',')]
        if len(cols) == 1 and cols[0] in tbl['cols']: tbl['cols'][cols[0]]['uq'] = True

CONSTRAINT_START = re.compile(r'^(constraint|primary key|unique|check|foreign key|exclude)\b', re.I)

for f in files:
    for st in statements(open(f, encoding='utf8').read()):
        s = re.sub(r'\s+', ' ', st).strip()
        m = re.match(r'create table (if not exists )?([\w."]+) ?\((.*)\)\s*(inherits.*|partition.*|with.*)?$', s, re.I)
        if m:
            name = qn(m.group(2))
            tbl = tables.setdefault(name, {'cols': {}, 'order': []})
            for part in split_top(m.group(3)):
                if CONSTRAINT_START.match(part): table_constraint(tbl, part); continue
                cn, cd = parse_col(part)
                if cn not in tbl['cols']: tbl['order'].append(cn)
                tbl['cols'][cn] = cd
            continue
        m = re.match(r'alter table (if exists )?(only )?([\w."]+) (.*)$', s, re.I)
        if m:
            name = qn(m.group(3)); tbl = tables.get(name)
            if not tbl: continue
            for act in split_top(m.group(4)):
                a = act.strip()
                mm = re.match(r'add column (if not exists )?(.*)$', a, re.I) or (re.match(r'add (?!constraint|primary|unique|check|foreign)(.*)$', a, re.I) and re.match(r'add ()(.*)$', a, re.I))
                if mm:
                    cn, cd = parse_col(mm.group(2))
                    if cn not in tbl['cols']: tbl['order'].append(cn)
                    tbl['cols'][cn] = cd; continue
                mm = re.match(r'drop column (if exists )?"?(\w+)"?', a, re.I)
                if mm:
                    cn = mm.group(2).lower(); tbl['cols'].pop(cn, None)
                    if cn in tbl['order']: tbl['order'].remove(cn)
                    continue
                mm = re.match(r'rename column "?(\w+)"? to "?(\w+)"?', a, re.I)
                if mm:
                    o, nn = mm.group(1).lower(), mm.group(2).lower()
                    tbl['cols'][nn] = tbl['cols'].pop(o); tbl['order'][tbl['order'].index(o)] = nn; continue
                mm = re.match(r'add (constraint .*)$', a, re.I) or re.match(r'add ((primary key|unique|foreign key).*)$', a, re.I)
                if mm: table_constraint(tbl, mm.group(1)); continue
                mm = re.match(r'alter column "?(\w+)"? (set data )?type ([^ ]+( \w+)?)', a, re.I)
                if mm and mm.group(1).lower() in tbl['cols']:
                    tbl['cols'][mm.group(1).lower()]['type'] = mm.group(3).lower().split(' using')[0]
                mm = re.match(r'alter column "?(\w+)"? set not null', a, re.I)
                if mm and mm.group(1).lower() in tbl['cols']: tbl['cols'][mm.group(1).lower()]['nn'] = True
            continue
        m = re.match(r"create type ([\w.\"]+) as enum \((.*)\)$", s, re.I)
        if m:
            enums[qn(m.group(1))] = re.findall(r"'([^']*)'", m.group(2)); continue
        m = re.match(r"alter type ([\w.\"]+) add value (if not exists )?'([^']*)'", s, re.I)
        if m:
            vals = enums.setdefault(qn(m.group(1)), [])
            if m.group(3) not in vals: vals.append(m.group(3))
            continue
        m = re.match(r'drop table (if exists )?([\w."]+)', s, re.I)
        if m: tables.pop(qn(m.group(2)), None)


# ---------------------------------------------------------------- render

def ent(name):
    schema, table = name.split('.')
    return table if schema == 'public' else f'{schema}_{table}'

def mtype(t):
    t = re.sub(r'\(.*?\)', '', t).replace('[]', '_array').strip()
    return re.sub(r'\W+', '_', t) or 'unknown'

def keys(c):
    k = [x for x, on in (('PK', c['pk']), ('FK', bool(c['fk'])), ('UK', c['uq'] and not c['pk'])) if on]
    return ' ' + ', '.join(k) if k else ''

stubs = sorted({c['fk'][0] for d in tables.values() for c in d['cols'].values() if c['fk'] and c['fk'][0] not in tables})
lines = ['erDiagram']
for name in stubs:
    lines.append(f'    {ent(name)} {{\n        uuid id PK\n    }}')
for name in sorted(tables):
    d = tables[name]
    cols = [c for c in d['order'] if d['cols'][c]['pk'] or d['cols'][c]['fk'] or d['cols'][c]['uq']]
    lines.append(f'    {ent(name)} {{')
    for c in cols:
        lines.append(f"        {mtype(d['cols'][c]['type'])} {c}{keys(d['cols'][c])}")
    lines.append('    }')
for name in sorted(tables):
    d = tables[name]
    for c in d['order']:
        col = d['cols'][c]
        if not col['fk']: continue
        # One-to-one only when this column alone is the key (not part of a composite PK).
        one = col['uq'] or (col['pk'] and sum(x['pk'] for x in d['cols'].values()) == 1)
        left = '||' if col['nn'] else '|o'
        right = 'o|' if one else 'o{'
        lines.append(f'    {ent(col["fk"][0])} {left}--{right} {ent(name)} : "{c}"')

out = ['# ConVía data model (DER)', '',
       '<!-- Generated by `python scripts/gen-der.py` from supabase/migrations/. Do not edit by hand. -->', '',
       f'{len(tables)} tables ({sum(1 for t in tables if t.startswith("public."))} in `public`, '
       f'{sum(1 for t in tables if not t.startswith("public."))} in `private`) after '
       f'`{os.path.basename(files[-1])}`. Every row that belongs to a person hangs from `auth.users` '
       'through `profiles.id` and is deleted in cascade when the account is deleted (`delete-account`, see [API.md](API.md)).', '',
       'The diagram shows keys only (PK, FK, UK); the full columns of each table are below it. '
       'Relationship labels are the foreign-key column. `||` = required, `|o` = optional (nullable FK), '
       '`o|` = at most one row (the FK is also the primary key or unique).', '',
       '```mermaid', *lines, '```', '', '## Enums', '', '| Type | Values |', '| --- | --- |']
for name in sorted(enums):
    out.append(f"| `{ent(name)}` | {', '.join(f'`{v}`' for v in enums[name])} |")
out += ['', '## Tables', '']
for name in sorted(tables):
    d = tables[name]
    out += [f'<details><summary><code>{name}</code> ({len(d["order"])} columns)</summary>', '',
            '| Column | Type | Null | Key | References |', '| --- | --- | --- | --- | --- |']
    for c in d['order']:
        col = d['cols'][c]
        ref = f'`{col["fk"][0]}.{col["fk"][1]}`' if col['fk'] else ''
        out.append(f"| `{c}` | `{col['type']}` | {'' if col['nn'] else 'yes'} | {keys(col).strip()} | {ref} |")
    out += ['', '</details>', '']

with open(os.path.join(root, 'docs', 'DER.md'), 'w', encoding='utf8', newline='\n') as f:
    f.write('\n'.join(out).rstrip() + '\n')
print(f'docs/DER.md: {len(tables)} tables, {len(enums)} enums')
