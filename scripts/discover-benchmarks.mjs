import { readFile, writeFile } from 'node:fs/promises';

const config=JSON.parse(await readFile(new URL('../config/benchmarks.json',import.meta.url),'utf8'));
const queries=process.argv.slice(2).length?process.argv.slice(2):config.benchmarks.filter(item=>item.kind==='proxy').map(item=>item.display_name.replace(/\s*\(.*\)$/,'').replace(/\b(TRI|Proxy)\b/gi,'').trim());
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const rows=[];
for(const query of queries){
  try{
    const response=await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`,{headers:{'user-agent':'FundScope benchmark discovery (manual review required)'}});
    if(!response.ok)throw new Error(`search HTTP ${response.status}`);
    const results=await response.json();
    const candidates=Array.isArray(results)?results.slice(0,8):[];
    const checks=[];
    for(const candidate of candidates){
      await sleep(300);
      try{
        const historyResponse=await fetch(`https://api.mfapi.in/mf/${candidate.schemeCode}`,{headers:{'user-agent':'FundScope benchmark discovery (manual review required)'}});
        if(!historyResponse.ok)throw new Error(`history HTTP ${historyResponse.status}`);
        const payload=await historyResponse.json();
        const navs=Array.isArray(payload.data)?payload.data:[];
        checks.push({scheme_code:Number(candidate.schemeCode),scheme_name:String(candidate.schemeName??''),status:payload.status,history_points:navs.length,first_nav:navs.at(-1)?.date??null,last_nav:navs[0]?.date??null,has_growth_or_index_name:/index|nifty|sensex|g-sec|gilt/i.test(String(candidate.schemeName??'')),candidate_only:true});
      }catch(error){checks.push({scheme_code:Number(candidate.schemeCode),scheme_name:String(candidate.schemeName??''),error:String(error),candidate_only:true});}
    }
    rows.push({query,candidates:checks});
  }catch(error){rows.push({query,error:String(error),candidates:[]});}
}
const report={generated_at:new Date().toISOString(),source:'MFapi search and historical NAV endpoint',warning:'Discovery output is evidence for human review only. It does not verify benchmark methodology, TRI equivalence, tracking, or category suitability and must never be copied to production config without independent review.',results:rows};
const output=JSON.stringify(report,null,2);
if(process.argv.includes('--write-report'))await writeFile(new URL('../config/benchmark-discovery-candidates.json',import.meta.url),output+'\n');
console.log(output);
