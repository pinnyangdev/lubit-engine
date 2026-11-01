from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'src' / 'content.ts'
s = p.read_text(encoding='utf-8')

old = "signIn: { label: '디스코드', href: '#' }"
new = "signIn: { label: '디스코드', href: 'https://discord.gg/3tpscUy32u' }"

if old in s:
    s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf-8')
    print('OK: href 연결 완료')
else:
    print('이미 수정됨' if 'discord.gg/3tpscUy32u' in s else '패턴을 찾지 못함')
