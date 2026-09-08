# 自動対局ログ（logs/run*.jsonl）を集計し、台詞のおかしな所を探す
import glob, json, re, collections, sys

rows = []
pattern = sys.argv[1] if len(sys.argv) > 1 else 'logs/run*.jsonl'
for path in sorted(glob.glob(pattern)):
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line:
            rows.append(json.loads(line))

results = [r for r in rows if r['type'] == 'result']
verdicts = [r for r in rows if r['type'] == 'verdict']
praises = [r for r in rows if r['type'] == 'praise']
mutters = [r for r in rows if r['type'] in ('mutter', 'whisper')]
errors = [r for r in rows if r['type'] == 'error']

print('=== 対局数', len(results), ' エラー', len(errors))
print('結果:', collections.Counter(r['result'] for r in results))
print('平均手数:', round(sum(r['plies'] for r in results) / max(1, len(results)), 1))
tot = collections.Counter()
for r in results:
    for k in ('scold', 'bad', 'l3', 'l2', 'praise', 'redo'):
        tot[k] += r[k]
print('一局あたり: ', {k: round(v / max(1, len(results)), 2) for k, v in tot.items()})
print('戦型別 ばかもん/悪手:')
by_open = collections.defaultdict(lambda: [0, 0, 0])
for r in results:
    b = by_open[r['opening']]
    b[0] += 1; b[1] += r['scold']; b[2] += r['bad']
for k, (n, s, b) in sorted(by_open.items()):
    print(f'  {k}: {n}局 ばかもん{s} 悪手{b}')

print('\n=== 段階と種類')
print(collections.Counter((r['level'], r['kind']) for r in verdicts))
print(collections.Counter(r['headline'] for r in verdicts))

# 手の名前を伏せてテンプレート化
MOVE = re.compile(r'[▲△][１-９同][一二三四五六七八九]?[歩香桂銀金角飛玉と杏圭全馬龍][打成]?')
def template(text):
    return MOVE.sub('▲手', text)

print('\n=== 説教の文型（回数）')
tmpl = collections.Counter(template(r['why']) for r in verdicts)
for t, n in tmpl.most_common():
    print(f'{n:4d}  {t}')

print('\n=== 頷き・独り言（回数）')
for t, n in collections.Counter(r['why'] for r in praises + mutters).most_common():
    print(f'{n:4d}  {t}')

# 形勢の行を読む
def parse_eval(line):
    m = re.search(r'正解 (\S+) → 形勢 ([+\-]?\d+|先手\d+手詰|後手\d+手詰)[^\n]*\n指した (\S+) → 形勢 ([+\-]?\d+|先手\d+手詰|後手\d+手詰)', line)
    if not m:
        return None
    def val(s):
        if s.startswith('先手'): return 30000
        if s.startswith('後手'): return -30000
        return int(s)
    return m.group(1), val(m.group(2)), m.group(3), val(m.group(4))

print('\n=== 疑わしいもの')
sus = []
for r in verdicts:
    e = parse_eval(r.get('evalLine', ''))
    if e:
        best_mv, best_v, played_mv, played_v = e
        if best_v <= played_v:
            sus.append(('正解の形勢が指した手以下', r))
        if r['level'] == 5 and best_v - played_v < 600 and best_v < 30000:
            sus.append(('段階5なのに落ち幅が小さい', r))
        if r['level'] == 2 and played_v < 150 and played_v > -30000:
            sus.append(('段階2「良い手」なのに指した後が互角以下', r))
    w = r['why']
    if '取れた' in w and r['usi'] and 'x' in r.get('usi', ''):
        sus.append(('取る手なのに「取れた」', r))
    if w.count('。') >= 4:
        sus.append(('文が長い', r))
    if '同' in r['move'] and '同' in w:
        sus.append(('「同」が多い', r))
seen = collections.Counter(k for k, _ in sus)
print(seen)
for k, r in sus[:40]:
    print(f'- [{k}] g{r["game"]} {r["opening"]} ply{r["ply"]} {r["move"]} L{r["level"]}: {r["why"]} | {r.get("evalLine","").replace(chr(10)," / ")}')

print('\n=== 段階5（ばかもーん）の全文サンプル')
for r in [v for v in verdicts if v['level'] == 5][:25]:
    print(f'- g{r["game"]} {r["opening"]} ply{r["ply"]} {r["move"]}: {r["why"]} | {r.get("evalLine","").replace(chr(10)," / ")}')

print('\n=== 段階4 サンプル')
for r in [v for v in verdicts if v['level'] == 4][:25]:
    print(f'- g{r["game"]} {r["opening"]} ply{r["ply"]} {r["move"]}: {r["headline"]} / {r["why"]} | {r.get("evalLine","").replace(chr(10)," / ")}')

print('\n=== 段階2・3 サンプル')
for r in [v for v in verdicts if v['level'] <= 3][:25]:
    print(f'- g{r["game"]} {r["opening"]} ply{r["ply"]} {r["move"]} L{r["level"]}: {r["why"]} | {r.get("evalLine","").replace(chr(10)," / ")}')

print('\n=== 頷きの出た手数（早すぎないか）')
for r in praises:
    if r['ply'] <= 12:
        print(f'- g{r["game"]} {r["opening"]} ply{r["ply"]} {r["move"]}: {r["why"][:30]}')

print('\n=== 小声（狙い）サンプル')
for r in [m for m in mutters if m['type'] == 'whisper'][:15]:
    print(f'- g{r["game"]} ply{r["ply"]} after {r["move"]}: {r["why"]} gain={r.get("gain")}')
