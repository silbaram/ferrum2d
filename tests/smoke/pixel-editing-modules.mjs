import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
export async function pixelModuleUrl(name,imports={}) {
  let code=ts.transpileModule(await readFile(new URL('../../apps/studio/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const[from,to]of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
export async function checkedPixelImport(url){try{return await import(url);}catch(error){process.exitCode=1;throw error;}}
export const documentUrl=await pixelModuleUrl('placementPixelDocument',{'./placementPixelIndexed':await pixelModuleUrl('placementPixelIndexed'),'./placementPixelHistory':await pixelModuleUrl('placementPixelHistory'),'./placementPixelAtlas':await pixelModuleUrl('placementPixelAtlas')});
export const drawingUrl=await pixelModuleUrl('placementPixelDrawing',{'./placementPixelDocument':documentUrl});
export const maskUrl=await pixelModuleUrl('placementPixelMask',{'./placementPixelDocument':documentUrl,'./placementPixelDrawing':drawingUrl});
export const transformUrl=await pixelModuleUrl('placementPixelTransform',{'./placementPixelDocument':documentUrl});
export const pixelTransform=await checkedPixelImport(transformUrl);
export const selectionUrl=await pixelModuleUrl('placementPixelSelection',{'./placementPixelDocument':documentUrl,'./placementPixelMask':maskUrl,'./placementPixelTransform':transformUrl});
export const pixelDocument=await checkedPixelImport(documentUrl),pixelMask=await checkedPixelImport(maskUrl),pixelSelection=await checkedPixelImport(selectionUrl),pixelDrawing=await checkedPixelImport(drawingUrl);
