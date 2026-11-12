import type { SnapshotManifest } from './types';

const DB_NAME='fundscope-snapshot-cache';
const STORE='snapshots';
const CACHE_ID='latest';

export interface CachedSnapshotIndex {
  id:string;
  manifest:SnapshotManifest;
  indexPath:string;
  encryptedIndex:ArrayBuffer;
  encryptedBytes:number;
  sha256:string;
  savedAt:number;
}

function openCache():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error('Snapshot device cache is unavailable.'));
    request.onblocked=()=>reject(new Error('Snapshot device cache is blocked.'));
  });
}

export async function readCachedSnapshotIndex():Promise<CachedSnapshotIndex|null>{
  const db=await openCache();
  try{
    const tx=db.transaction(STORE,'readonly');
    const row=await new Promise<CachedSnapshotIndex|undefined>((resolve,reject)=>{const request=tx.objectStore(STORE).get(CACHE_ID);request.onsuccess=()=>resolve(request.result as CachedSnapshotIndex|undefined);request.onerror=()=>reject(request.error);});
    return row??null;
  }finally{db.close();}
}

export async function saveCachedSnapshotIndex(value:Omit<CachedSnapshotIndex,'id'|'savedAt'>):Promise<void>{
  const db=await openCache();
  try{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({...value,id:CACHE_ID,savedAt:Date.now()} satisfies CachedSnapshotIndex);
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }finally{db.close();}
}

export async function clearCachedSnapshotIndex():Promise<void>{
  try{const db=await openCache();try{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}catch{/* Device storage is optional; network snapshot unlock remains available. */}
}
