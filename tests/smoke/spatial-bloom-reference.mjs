// Independent CPU signal reference from an exposure-reduced public HDR capture.
// Filtering is performed vertically before horizontally; the GPU does the reverse.
export function wideBloomReference(pixels,width,height,{quality='balanced',radius=64,threshold=1,strength=1,exposure=0,dpr=1}={}){
 const linear=x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);
 const encode=x=>x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055;
 const original=Float64Array.from({length:width*height*3},(_,i)=>linear(pixels[Math.floor(i/3)*4+i%3]/255)*16);
 let image=original.slice(),w=width,h=height,scale=quality==='low'?4:2,kernel=quality==='high'?8:4;
 for(let i=0;i<image.length;i+=3){const peak=Math.max(image[i],image[i+1],image[i+2]);const factor=Math.max(peak-threshold,0)/Math.max(peak,.00001);for(let c=0;c<3;c++)image[i+c]*=factor;}
 const down=ratio=>{const nw=Math.ceil(w/ratio),nh=Math.ceil(h/ratio),next=new Float64Array(nw*nh*3);
  for(let y=0;y<nh;y++)for(let x=0;x<nw;x++)for(let dy=0;dy<ratio;dy++)for(let dx=0;dx<ratio;dx++){
   const from=(Math.min(h-1,y*ratio+dy)*w+Math.min(w-1,x*ratio+dx))*3,to=(y*nw+x)*3;
   for(let c=0;c<3;c++)next[to+c]+=image[from+c]/(ratio*ratio);
  }image=next;w=nw;h=nh;
 };
 down(scale);while(radius*dpr>scale*kernel&&(w>1||h>1)){scale*=2;down(2);}
 const step=radius*dpr/(scale*kernel);
 for(const vertical of [true,false]){
  const next=new Float64Array(image.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   let weight=0;const to=(y*w+x)*3;
   for(let i=-kernel;i<=kernel;i++){
    const k=Math.exp(-4*(i/kernel)**2),offset=i*step,base=Math.floor(offset),fraction=offset-base;
    const at=delta=>(Math.max(0,Math.min(h-1,y+(vertical?delta:0)))*w+Math.max(0,Math.min(w-1,x+(vertical?0:delta))))*3;
    for(let c=0;c<3;c++)next[to+c]+=(image[at(base)+c]*(1-fraction)+image[at(base+1)+c]*fraction)*k;weight+=k;
   }for(let c=0;c<3;c++)next[to+c]/=weight;
  }image=next;
 }
 const output=new Uint8Array(width*height*4),sample=(x,y,c)=>image[(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*3+c];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const px=(x+.5)/scale-.5,py=(y+.5)/scale-.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
  for(let c=0;c<3;c++){
   const bloom=(sample(ix,iy,c)*(1-fx)+sample(ix+1,iy,c)*fx)*(1-fy)+(sample(ix,iy+1,c)*(1-fx)+sample(ix+1,iy+1,c)*fx)*fy;
   output[(y*width+x)*4+c]=Math.max(0,Math.min(255,Math.round(encode((original[(y*width+x)*3+c]+bloom*strength)*2**exposure)*255)));
  }output[(y*width+x)*4+3]=255;
 }
 return output;
}
