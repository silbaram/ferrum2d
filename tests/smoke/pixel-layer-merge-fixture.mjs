/** Layer order is bottom-to-top; the hidden locked cel must survive every merge. */
export function pixelMergeSource({version=7,rounding=false}={}) {
  const layers=[
    {id:'base',name:'Base',visible:true,locked:false},
    {id:'hidden',name:'Hidden original',visible:false,locked:true},
    {id:'middle',name:'Middle',visible:true,locked:false},
    {id:'top',name:'Overlay',visible:true,locked:false},
  ];
  const frames=[0,1].map(i=>({id:'frame-'+i,durationMs:83+i*41,cels:layers.map((layer,j)=>({layerId:layer.id,rgba:Buffer.from([
    [[20,80,150,255],[31,42,53,0]],
    [[3,2,1,255],[190,180,170,128]],
    [[200,10,70,rounding&&i===1?32:255],[20,40,90,255]],
    [[0,200,255,rounding&&i===1?32:64],[99,88,77,0]],
  ][j].flat()).toString('base64')}))}));
  return {format:'ferrum2d.pixel-document',version,name:'merge-fixture',width:2,height:1,colorSpace:'srgb',palette:['#ff0000ff','#0000ffff'],layers,frames,
    ...(version===3?{}:{tags:[{id:'idle',name:'Idle',clipId:4,frameIds:['frame-1','frame-0'],loop:true,...(version===7?{direction:'reverse'}:{})}],initialTag:'idle',nextClipId:5})};
}
