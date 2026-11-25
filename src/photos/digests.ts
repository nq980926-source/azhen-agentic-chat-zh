/** Browser-only byte integrity; MD5 is Content-MD5, never authentication. */
export function bytesFromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), c => c.charCodeAt(0));
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.slice().buffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), b => b.toString(16).padStart(2,"0")).join("");
}
export function contentMd5(input: Uint8Array): string {
  const length = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(length); bytes.set(input); bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(length-8, (input.length * 8) >>> 0, true);
  view.setUint32(length-4, Math.floor(input.length / 0x20000000), true);
  const shifts = [[7,12,17,22],[5,9,14,20],[4,11,16,23],[6,10,15,21]];
  let a=0x67452301,b=0xefcdab89,c=0x98badcfe,d=0x10325476;
  for (let offset=0;offset<length;offset+=64) {
    const initial=[a,b,c,d];
    for(let i=0;i<64;i++) {
      let f:number,g:number;
      if(i<16){f=(b&c)|(~b&d);g=i;}
      else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}
      else if(i<48){f=b^c^d;g=(3*i+5)%16;}
      else {f=c^(b|~d);g=(7*i)%16;}
      const sum=(a+f+Math.floor(Math.abs(Math.sin(i+1))*2**32)+view.getUint32(offset+g*4,true))|0;
      const shift=shifts[Math.floor(i/16)][i%4];
      const next=(b+((sum<<shift)|(sum>>>(32-shift))))|0;
      a=d;d=c;c=b;b=next;
    }
    a=(a+initial[0])|0;b=(b+initial[1])|0;c=(c+initial[2])|0;d=(d+initial[3])|0;
  }
  const result=new Uint8Array(16), output=new DataView(result.buffer);
  [a,b,c,d].forEach((x,i)=>output.setUint32(i*4,x,true));
  return btoa(String.fromCharCode(...result));
}
