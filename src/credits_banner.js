// Render a compact black-and-gold balance image in Workers without
// storing a separate file for every possible balance value.
const GLYPHS={"0":["01110","10001","10011","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],"2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],"4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","10000","11110","00001","00001","11110"],"6":["01110","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],"8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","01110"],"A":["01110","10001","10001","11111","10001","10001","10001"],"B":["11110","10001","10001","11110","10001","10001","11110"],"C":["01111","10000","10000","10000","10000","10000","01111"],"D":["11110","10001","10001","10001","10001","10001","11110"],"E":["11111","10000","10000","11110","10000","10000","11111"],"G":["01111","10000","10000","10111","10001","10001","01111"],"I":["11111","00100","00100","00100","00100","00100","11111"],"L":["10000","10000","10000","10000","10000","10000","11111"],"M":["10001","11011","10101","10101","10001","10001","10001"],"N":["10001","11001","10101","10011","10001","10001","10001"],"O":["01110","10001","10001","10001","10001","10001","01110"],"P":["11110","10001","10001","11110","10000","10000","10000"],"R":["11110","10001","10001","11110","10100","10010","10001"],"S":["01111","10000","10000","01110","00001","00001","11110"],"T":["11111","00100","00100","00100","00100","00100","00100"],"U":["10001","10001","10001","10001","10001","10001","01110"],"V":["10001","10001","10001","10001","10001","01010","00100"],"Y":["10001","10001","01010","00100","00100","00100","00100"]," ":["00000","00000","00000","00000","00000","00000","00000"],":":["00000","00100","00100","00000","00100","00100","00000"]};
const W=760,H=254;
const crcTable=Uint32Array.from({length:256},(_,n)=>{
  let x=n;for(let k=0;k<8;k++)x=x&1?0xedb88320^(x>>>1):x>>>1;return x>>>0;
});
function crc(buf){let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function pack32(x){return Uint8Array.of((x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);}
function chunk(type,data){
  const label=new TextEncoder().encode(type);
  const value=new Uint8Array(label.length+data.length);value.set(label);value.set(data,label.length);
  const out=new Uint8Array(value.length+12);out.set(pack32(data.length));out.set(value,4);out.set(pack32(crc(value)),value.length+4);
  return out;
}
export async function renderCreditsBanner(id,count){
  const rgb=new Uint8Array(W*H*3);
  function pixel(x,y,c){
    if(x<0||x>=W||y<0||y>=H)return;
    const k=(y*W+x)*3;rgb[k]=c[0];rgb[k+1]=c[1];rgb[k+2]=c[2];
  }
  function rect(x,y,w,h,c){for(let j=Math.max(0,y);j<Math.min(H,y+h);j++)for(let i=Math.max(0,x);i<Math.min(W,x+w);i++)pixel(i,j,c);}
  const bg=[19,17,16],gold=[207,161,88],soft=[235,217,183],low=[145,123,94];
  rect(0,0,W,H,bg);
  rect(10,10,W-20,3,gold);rect(10,H-13,W-20,3,gold);
  rect(10,10,3,H-20,gold);rect(W-13,10,3,H-20,gold);
  rect(34,86,692,1,[91,72,48]);
  function label(str,x,y,scale,color){
    for(const ch of String(str).toUpperCase()){
      const g=GLYPHS[ch]||GLYPHS[" "];
      for(let iy=0;iy<7;iy++)for(let ix=0;ix<5;ix++)
        if(g[iy][ix]==="1")rect(x+ix*scale,y+iy*scale,scale,scale,color);
      x+=6*scale;
    }
  }
  label("DAME CAMELIAS",42,28,6,gold);
  label("TELEGRAM ID: "+String(id),43,102,3,low);
  label("PUBLICATIONS LEFT",43,164,4,soft);
  const countText=String(Math.max(0,Number(count)||0));
  const scale=countText.length>4?6:9;
  label(countText,W-45-countText.length*6*scale,137,scale,gold);
  const raw=new Uint8Array(H*(W*3+1));
  for(let y=0;y<H;y++)raw.set(rgb.subarray(y*W*3,(y+1)*W*3),y*(W*3+1)+1);
  const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  const packed=new Uint8Array(await new Response(stream).arrayBuffer());
  const header=new Uint8Array(13);header.set(pack32(W));header.set(pack32(H),4);header[8]=8;header[9]=2;
  const pieces=[Uint8Array.of(137,80,78,71,13,10,26,10),chunk("IHDR",header),chunk("IDAT",packed),chunk("IEND",new Uint8Array())];
  const out=new Uint8Array(pieces.reduce((n,b)=>n+b.length,0));
  let pos=0;for(const part of pieces){out.set(part,pos);pos+=part.length;}
  return out;
}
