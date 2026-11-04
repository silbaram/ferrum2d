import {pixelModuleUrl as url,documentUrl,checkedPixelImport} from './pixel-editing-modules.mjs';
const gif=await url('placementPixelGif'),png=await url('placementPixelPng',{'./placementPixelDocument':documentUrl});
const apng=await url('placementPixelApng',{'./placementPixelGif':gif,'./placementPixelPng':png});
const animation=await url('placementPixelAnimation',{'./placementPixelDocument':documentUrl,'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href});
export const animationExport=await checkedPixelImport(await url('placementPixelAnimationExport',{'./placementPixelDocument':documentUrl,'./placementPixelAnimation':animation,'./placementPixelGif':gif,'./placementPixelApng':apng}));
