import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourcePath=resolve('docs/classification-discovery-c0.md');
const markdown=await readFile(sourcePath,'utf8');
const categories=[];
const start=markdown.indexOf('| Schemes | Raw AMFI category |');
const end=markdown.indexOf('## Passive-family name review',start);
if(start<0||end<0)throw new Error('The C0 report no longer contains its expected category inventory section.');
for(const line of markdown.slice(start,end).split(/\r?\n/)){
  if(!/^\|\s*[\d,]+\s*\|/.test(line))continue;
  const cells=line.split('|').slice(1,-1).map(value=>value.trim());
  const schemeCount=Number((cells[0]??'').replace(/,/g,''));
  const categoryRaw=cells[1]??'';
  const headerRaw=cells.at(-1)??'';
  const structureMatch=/^(open|close|interval)\s+ended/i.exec(headerRaw);
  if(!Number.isInteger(schemeCount)||!categoryRaw||!headerRaw)continue;
  categories.push({categoryRaw,headerRaw,structure:structureMatch?.[1]?.toLowerCase()??'unknown',schemeCount,activeCount:null,sampleSchemeNames:[]});
}
if(!categories.length)throw new Error('Could not read the category table in docs/classification-discovery-c0.md.');
const inventory={inventoryMode:'offline-c0-reference',source:'Checked-in AMFI discovery report from 2026-11-01; no live data was fetched.',activeCountsAvailable:false,sampleNamesAvailable:false,schemeRowCount:14441,distinctCategoryCount:categories.length,reportedPriorHeldOtherCount:5612,reportedPriorHeldOtherSource:'User-provided FundScope taxonomy prompt; this is a historical baseline, not a current v3 count.',categories};
for(const target of ['docs/category-inventory.json','tests/fixtures/category-inventory.json']){const output=resolve(target);await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(inventory,null,2)}\n`,'utf8');}
console.log(JSON.stringify({mode:inventory.inventoryMode,categories:categories.length,reportedPriorHeldOtherCount:inventory.reportedPriorHeldOtherCount,files:['docs/category-inventory.json','tests/fixtures/category-inventory.json']},null,2));
