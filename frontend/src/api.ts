const base=(import.meta.env.VITE_API_URL||'http://localhost:5050').replace(/\/$/,'');
export async function api<T>(path:string,init:RequestInit={}){
  const response=await fetch(`${base}${path}`,{...init,headers:{'Content-Type':'application/json','x-operator-key':import.meta.env.VITE_OPERATOR_API_KEY||'',...init.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
  return data as T;
}
