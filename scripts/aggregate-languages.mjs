// Aggregates byte-per-language stats across a user profile and a set of orgs,
// then renders a horizontal stacked-bar SVG. Run via GitHub Actions with GITHUB_TOKEN set.

const OWNERS=[
  {name:'M1dnight-ofcl',type:'user'},
  {name:'Flux-Macro',type:'org'},
  {name:'Beansite-Dev',type:'org'},
  {name:'Klorine-Dev',type:'org'},
];

const TOKEN=process.env.GITHUB_TOKEN;
if(!TOKEN) throw new Error('GITHUB_TOKEN is required');
const HEADERS={Authorization:`Bearer ${TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};

const EXCLUDE_REPOS=new Set([
  "Beansite-Dev/games",
]); // add 'owner/repo' entries here to skip forks-of-forks, archives, etc.
const OUT_SVG='profile/language-stats.svg';
const TOP_N=8;

async function ghFetch(url){
  const res=await fetch(url,{headers:HEADERS});
  if(!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res;
}

async function listRepos(owner,type){
  const base=type==='org'
    ?`https://api.github.com/orgs/${owner}/repos?per_page=100&type=all`
    :`https://api.github.com/users/${owner}/repos?per_page=100&type=owner`;
  const repos=[];
  let url=base;
  while(url){
    const res=await ghFetch(url);
    const page=await res.json();
    repos.push(...page.filter(r=>!r.fork&&!r.archived&&!EXCLUDE_REPOS.has(`${owner}/${r.name}`)).map(r=>r.name));
    const link=res.headers.get('link');
    url=link?.match(/<([^>]+)>;\s*rel="next"/)?.[1]??'';
  }
  return repos;
}

async function getLanguages(owner,repo){
  const res=await ghFetch(`https://api.github.com/repos/${owner}/${repo}/languages`);
  return res.json();
}

async function aggregate(){
  const totals={};
  for(const {name,type} of OWNERS){
    const repos=await listRepos(name,type);
    for(const repo of repos){
      const langs=await getLanguages(name,repo);
      for(const [lang,bytes] of Object.entries(langs)) totals[lang]=(totals[lang]??0)+bytes;
      await new Promise(r=>setTimeout(r,120)); // stay well under the secondary rate limit
    }
  }
  return totals;
}

async function loadLinguistColors(){
  const res=await fetch('https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist/languages.yml');
  const text=await res.text();
  const colors={};
  let currentLang=null;
  for(const line of text.split('\n')){
    const langMatch=line.match(/^(\S.*):\s*$/);
    if(langMatch){currentLang=langMatch[1].replace(/^"|"$/g,'');continue;}
    const colorMatch=line.match(/^\s+color:\s*"?(#[0-9a-fA-F]{3,6})"?/);
    if(colorMatch&&currentLang) colors[currentLang]=colorMatch[1];
  }
  return colors;
}

function buildSvg(totals,colors){
  const entries=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((sum,[,bytes])=>sum+bytes,0);
  const top=entries.slice(0,TOP_N);
  const rest=entries.slice(TOP_N).reduce((sum,[,bytes])=>sum+bytes,0);
  if(rest>0) top.push(['Other',rest]);

  const width=760,barHeight=24,rowHeight=26,padding=16;
  const height=padding*2+barHeight+8+top.length*rowHeight;
  const fallback='#8a8a8a';

  let x=padding;
  const barSegments=top.map(([lang,bytes])=>{
    const w=(bytes/total)*(width-padding*2);
    const seg=`<rect x="${x.toFixed(2)}" y="${padding}" width="${w.toFixed(2)}" height="${barHeight}" fill="${colors[lang]??fallback}"/>`;
    x+=w;
    return seg;
  }).join('');

  const legend=top.map(([lang,bytes],i)=>{
    const pct=((bytes/total)*100).toFixed(1);
    const y=padding+barHeight+24+i*rowHeight;
    return `<circle cx="${padding+6}" cy="${y-5}" r="6" fill="${colors[lang]??fallback}"/>`+
           `<text x="${padding+20}" y="${y}" font-family="Segoe UI, sans-serif" font-size="13" fill="#c9d1d9">${lang} - ${pct}%</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`+
    `<rect width="${width}" height="${height}" fill="#0d1117" rx="8"/>`+
    `<rect x="${padding}" y="${padding}" width="${width-padding*2}" height="${barHeight}" rx="4" fill="#161b22"/>`+
    barSegments+legend+
    `</svg>`;
}

const [totals,colors]=await Promise.all([aggregate(),loadLinguistColors()]);
const {writeFile,mkdir}=await import('node:fs/promises');
await mkdir('profile',{recursive:true});
await writeFile(OUT_SVG,buildSvg(totals,colors));
console.log(`Wrote ${OUT_SVG} across ${Object.keys(totals).length} languages`);
