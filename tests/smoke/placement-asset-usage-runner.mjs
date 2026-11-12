import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {preparePlacementTestBuild} from './placement-test-build.mjs';
import {smokePlacementAssetUsage} from './placement-asset-usage-smoke.mjs';
const base=await preparePlacementTestBuild(resolve('apps/studio/dist'));
const server=createServer(async(request,response)=>{
 try{const path=new URL(request.url,'http://localhost').pathname,file=resolve(base,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));assert(file.startsWith(base+sep));response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(await readFile(file));}
 catch{response.writeHead(404);response.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const parent=await browser.newPage();await parent.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
 const results=[];for(const mode of ['2d','spatial'])results.push(await smokePlacementAssetUsage(parent,mode));
 console.log(JSON.stringify({ok:true,results},null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
