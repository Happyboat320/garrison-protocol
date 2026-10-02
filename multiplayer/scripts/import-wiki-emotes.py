"""维护时手动导入 BWIKI 图片，不在构建/运行期间请求第三方。
用法：python3 multiplayer/scripts/import-wiki-emotes.py [已下载的页面HTML]
保留分类、来源、revision；按源图片名去重历史重复预览，只保存 PNG。
"""
from pathlib import Path
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor
import urllib.request, re, json, hashlib, sys
ROOT=Path(__file__).resolve().parents[1]
SOURCE='https://wiki.biligame.com/arknights/%E6%B8%B8%E6%88%8F%E8%A1%A8%E6%83%85%E4%B8%80%E8%A7%88'
def fetch(url):
    request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':SOURCE})
    with urllib.request.urlopen(request,timeout=30) as response: return response.read()
class Images(HTMLParser):
    def __init__(self): super().__init__(); self.images=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='img' and a.get('alt','').startswith('表情 '): self.images.append(a)
html=Path(sys.argv[1]).read_text() if len(sys.argv)>1 else fetch(SOURCE).decode()
parts=re.split(r'<big>(.*?)</big>',html,flags=re.S)
groups=[]; entries=[]; seen=set()
labels={'cooperate':'很快就好！','noproblem':'没问题！','respect':'敬礼！','call':'欢呼！','playingcool':'酷！','sad':'伤心','dying':'快死了'}
for i in range(1,len(parts),2):
    group={'id':f'group-{(i+1)//2}','name':parts[i],'emotes':[]}
    parser=Images();parser.feed(parts[i+1])
    for image in parser.images:
        key=image['alt']
        if key in seen: continue
        seen.add(key)
        ident='emote-'+hashlib.sha256(key.encode()).hexdigest()[:12]
        name=key.removeprefix('表情 ').removesuffix('.png').split(' ')[-1]
        url=image.get('srcset',image['src']).split(' ')[0]
        if not re.fullmatch(r'https://patchwiki\.biligame\.com/images/arknights/[\w/.-]+\.png',url): raise ValueError(url)
        entry={'id':ident,'name':labels.get(name,name),'category':group['id'],'file':ident+'.png','sourceName':key,'sourceUrl':url}
        group['emotes'].append(ident);entries.append(entry)
    groups.append(group)
if len(entries)<30: raise ValueError('解析结果不足，检查页面结构')
assets=ROOT/'client/emotes';assets.mkdir(exist_ok=True)
def download(entry):
    target=assets/entry['file']
    payload=target.read_bytes() if target.exists() else fetch(entry['sourceUrl'])
    if not payload.startswith(b'\x89PNG\r\n\x1a\n') or len(payload)>512000: raise ValueError(entry['sourceName'])
    target.write_bytes(payload)
with ThreadPoolExecutor(max_workers=4) as pool: list(pool.map(download,entries))
revision=re.search(r'"wgRevisionId":(\d+)',html).group(1)
manifest={'source':SOURCE,'revision':int(revision),'categories':groups,'emotes':entries}
(ROOT/'shared/emotes.js').write_text('/** BWIKI 游戏表情一览：本地图片及固定 ID 白名单。由 scripts/import-wiki-emotes.py 生成。 */\nexport const EMOTE_CATALOG = '+json.dumps(manifest,ensure_ascii=False,indent=2)+';\nexport const EMOTE_BY_ID = Object.freeze(Object.fromEntries(EMOTE_CATALOG.emotes.map(e => [e.id, Object.freeze(e)])));\nexport const EMOTE_IDS = Object.freeze(EMOTE_CATALOG.emotes.map(e => e.id));\n')
print('分类',len(groups),'图片',len(entries),'总大小',sum(p.stat().st_size for p in assets.glob('*.png')))
