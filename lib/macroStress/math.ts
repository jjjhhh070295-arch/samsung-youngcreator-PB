export function mean(v:number[]){return v.reduce((a,b)=>a+b,0)/Math.max(v.length,1)}
export function std(v:number[]){const m=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/Math.max(v.length-1,1))}
export function quantile(values:number[],q:number){const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,i=Math.floor(p),f=p-i;return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*f}
export function inverse(a:number[][]){const n=a.length,m=a.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;[m[c],m[p]]=[m[p],m[c]];const d=m[c][c];if(Math.abs(d)<1e-12)throw new Error("Singular regression matrix");for(let j=0;j<2*n;j++)m[c][j]/=d;for(let r=0;r<n;r++)if(r!==c){const f=m[r][c];for(let j=0;j<2*n;j++)m[r][j]-=f*m[c][j]}}return m.map(r=>r.slice(n))}
export function multiply(a:number[][],b:number[][]){return a.map(r=>b[0].map((_,j)=>r.reduce((s,x,k)=>s+x*b[k][j],0)))}
export function covariance(rows:number[][]){const k=rows[0].length,mu=Array.from({length:k},(_,j)=>mean(rows.map(r=>r[j])));return Array.from({length:k},(_,i)=>Array.from({length:k},(_,j)=>rows.reduce((s,r)=>s+(r[i]-mu[i])*(r[j]-mu[j]),0)/(rows.length-1)))}
export function cholesky(a:number[][]){const n=a.length,l=Array.from({length:n},()=>Array(n).fill(0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=0;for(let k=0;k<j;k++)s+=l[i][k]*l[j][k];l[i][j]=i===j?Math.sqrt(Math.max(a[i][i]-s,1e-12)):(a[i][j]-s)/l[j][j]}return l}
export function normal(rng:()=>number){const u=Math.max(rng(),1e-12),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
export function seeded(seed:number){let x=seed>>>0;return()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296}}
