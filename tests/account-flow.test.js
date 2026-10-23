import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as data from '../src/data.js';

// Run the actual account submit and hashchange handlers with a minimal DOM adapter.
// Rendering stays stubbed; view HTML is checked directly where feedback is shown.
const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8'))
 .replace(/^import .* from '\.\/data.js';\n/, '')
 .replace(/\nrender\(\);\s*$/, '\n');
const profile = {fullName:'Anika Rao',registration:'23BCE1024',email:'anika@example.test',phone:''};
function setup(saved = null, initialRoute = 'login') {
 const local = new Map(saved ? [['smartpick-demo-profile', JSON.stringify(saved)]] : []);
 const session = new Map();
 const storage = map => ({getItem:key=>map.get(key) ?? null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)});
 const callbacks = {};
 const messages = new Map();
 let form;
 const document = {
  querySelector: selector => selector === '#account-form' ? form : selector === 'main' ? {scrollTo(){}} : null,
  querySelectorAll: () => []
 };
 const context = vm.createContext({
  ...data, console, document, location:{hash:`#${initialRoute}`},
  localStorage:storage(local),sessionStorage:storage(session),
  window:{addEventListener:(name,callback)=>{callbacks[name]=callback;}},
  FormData:class { constructor(target){this.target=target;} [Symbol.iterator](){return Object.entries(this.target.values)[Symbol.iterator]();} }
 });
 vm.runInContext(source,context);
 vm.runInContext('render = () => {};',context);
 return {
  local, session,
  read: expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`,context)),
  run: code => vm.runInContext(code,context),
  submit(mode, values) {
   messages.clear();
   form = {
    dataset:{mode},values,
    querySelector:selector=>{if(!messages.has(selector))messages.set(selector,{textContent:''});return messages.get(selector);},
    querySelectorAll:()=>Object.keys(values).map(name=>({name,setAttribute(){}})),elements:{identity:{focus(){}},fullName:{focus(){}}}
   };
   vm.runInContext('bindAccountForm();',context);
   form.onsubmit({preventDefault(){}});
  },
  message: selector => messages.get(selector)?.textContent || '',
  navigate(route) { context.location.hash=`#${route}`; callbacks.hashchange(); }
 };
}

test('a different login identity cannot overwrite a saved demo profile or start a session', () => {
 for (const identity of ['other@example.test','24BCE9999']) {
  const app=setup(profile);
  const original=app.local.get('smartpick-demo-profile');
  app.submit('login',{identity,password:'disposable'});
  assert.equal(app.local.get('smartpick-demo-profile'),original);
  assert.deepEqual(app.read('savedProfile'),profile);
  assert.equal(app.read('user'),null);
  assert.equal(app.session.has('smartpick-demo-session'),false);
  assert.match(app.message('#error-identity'),/different demo profile/);
  assert.equal(app.read('location.hash'),'#login');
 }
});

test('matching login accepts saved email or student ID without changing profile details', () => {
 for (const identity of [' ANIKA@EXAMPLE.TEST ','23bce1024']) {
  const app=setup(profile);
  app.submit('login',{identity,password:'any-demo-password'});
  assert.deepEqual(app.read('user'),profile);
  assert.deepEqual(JSON.parse(app.local.get('smartpick-demo-profile')),profile);
  assert.equal(app.session.get('smartpick-demo-session'),'active');
  app.navigate('home');
  assert.match(app.read('home()'),/Demo session started/);
 }
});

test('first-time demo login still creates a password-free local profile', () => {
 const app=setup();
 app.submit('login',{identity:'new@example.test',password:'disposable'});
 const saved=JSON.parse(app.local.get('smartpick-demo-profile'));
 assert.equal(saved.email,'new@example.test');
 assert.equal(saved.fullName,'Demo Student');
 assert.equal('password' in saved,false);
 assert.equal(app.session.get('smartpick-demo-session'),'active');
});

test('registration feedback survives arrival and rerenders, then clears on departure', () => {
 const app=setup(null,'register');
 app.submit('register',{...profile,password:'disposable',confirmPassword:'disposable'});
 app.navigate('home');
 assert.match(app.read('home()'),/Demo account created locally/);
 app.run('render();');
 assert.match(app.read('home()'),/Demo account created locally/);
 app.navigate('activity');
 assert.equal(app.read('accountMessage'),'');
 app.navigate('home');
 assert.doesNotMatch(app.read('home()'),/Demo account created locally/);
});

test('sign-out feedback survives login navigation and clears when leaving login', () => {
 const app=setup(profile,'home');
 app.run("user = {...savedProfile}; sessionStorage.setItem('smartpick-demo-session','active'); signOut();");
 app.navigate('login');
 assert.match(app.read("authScreen('login')"),/Signed out of the local demo/);
 assert.equal(app.session.has('smartpick-demo-session'),false);
 assert.equal(app.read('user'),null);
 assert.deepEqual(JSON.parse(app.local.get('smartpick-demo-profile')),profile);
 app.run('render();');
 assert.match(app.read("authScreen('login')"),/Signed out of the local demo/);
 app.navigate('register');
 assert.equal(app.read('accountMessage'),'');
});

test('explicit registration and profile editing still persist the intended profile', () => {
 const app=setup(profile,'register');
 const replacement={...profile,fullName:'Riya Sen',registration:'24BCE2048',email:'riya@example.test'};
 app.submit('register',{...replacement,password:'disposable',confirmPassword:'disposable'});
 assert.deepEqual(JSON.parse(app.local.get('smartpick-demo-profile')),replacement);
 app.navigate('profile');
 const edited={...replacement,phone:'+91 98765 43210'};
 app.submit('profile',edited);
 assert.deepEqual(JSON.parse(app.local.get('smartpick-demo-profile')),edited);
 assert.match(app.read('profile()'),/Demo profile saved/);
 app.navigate('settings');
 assert.equal(app.read('accountMessage'),'');
});
