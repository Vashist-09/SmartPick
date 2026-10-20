import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccountForm, cleanProfile, initials } from '../src/data.js';
const student = {fullName:'Anika Rao',registration:'23BCE1024',email:'anika@example.test',phone:'',password:'disposable',confirmPassword:'disposable'};
test('registration accepts a complete profile and optional phone', () => {
 assert.deepEqual(validateAccountForm('register',student), {});
 assert.deepEqual(validateAccountForm('register',{...student,phone:'+91 98765 43210'}), {});
});
test('registration reports invalid fields and mismatched passwords', () => {
 const errors=validateAccountForm('register',{fullName:'A',registration:'bad id',email:'bad',phone:'abc',password:'short',confirmPassword:'different'});
 assert.deepEqual(Object.keys(errors).sort(),['fullName','registration','email','phone','password','confirmPassword'].sort());
});
test('login validates both identity types without authenticating', () => {
 assert.deepEqual(validateAccountForm('login',{identity:'23BCE1024',password:'disposable'}),{});
 assert.deepEqual(validateAccountForm('login',{identity:'anika@example.test',password:'disposable'}),{});
 assert.ok(validateAccountForm('login',{identity:'a@',password:''}).identity);
});
test('recovery only validates an identity; profile edits do not require passwords', () => {
 assert.deepEqual(validateAccountForm('forgot',{identity:'anika@example.test'}),{});
 assert.deepEqual(validateAccountForm('profile',student),{});
});
test('profile persistence excludes passwords and normalizes identifiers', () => {
 assert.deepEqual(cleanProfile({...student,fullName:' Anika Rao ',registration:' sp1024 ',email:'ANIKA@example.test '}),{fullName:'Anika Rao',registration:'SP1024',email:'anika@example.test',phone:''});
 assert.equal(initials(' Anika Rao '),'AR');
});
