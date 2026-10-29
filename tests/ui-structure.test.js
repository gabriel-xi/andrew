import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../public/',import.meta.url);
const pages=['index','login','register','homepage','calendar','courses','tutors','me','admin','timecards','documents','reports','settings'];
test('Unisic UI: branding, script, theme and navigation on every screen',()=>{
 for(const page of pages){
  const html=readFileSync(new URL(page+'.html',root),'utf8');
  assert.match(html,/Unisic/,page+' missing branding');
  assert.match(html,/\/JS\/theme\.js/,page+' missing theme bootstrap');
  assert.match(html,new RegExp('/JS/'+page+'\\.js'),page+' missing page module');
  if(!['index','login','register'].includes(page))assert.match(html,/\/settings\.html/,page+' missing settings');
  assert.ok(existsSync(new URL('JS/'+page+'.js',root)),'missing module '+page);
 }
});
test('Styles contain both light and dark modes and compact density',()=>{
 const css=readFileSync(new URL('CSS/style.css',root),'utf8');
 assert.match(css,/\[data-theme="light"\]/);
 assert.match(css,/\[data-compact="true"\]/);
 const js=readFileSync(new URL('JS/theme.js',root),'utf8');
 assert.match(js,/localStorage/);
 assert.match(js,/prefers-color-scheme/);
});
