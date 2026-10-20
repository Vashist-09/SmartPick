export async function api<T>(path:string,init:RequestInit={}){
  const response=await fetch(path,{...init,credentials:'same-origin',headers:{'Content-Type':'application/json',...init.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
  return data as T;
}
