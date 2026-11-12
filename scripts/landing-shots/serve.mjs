import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [root, port] = [path.resolve(process.argv[2]), +process.argv[3]];
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.ttf':'font/ttf','.woff2':'font/woff2','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.onnx':'application/octet-stream'};
http.createServer((req,res)=>{ let p = decodeURIComponent(new URL(req.url,'http://x').pathname); let f = path.join(root,p);
 if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f,'index.html');
 if (!fs.existsSync(f)) { if (fs.existsSync(f+'.html')) f=f+'.html'; else f = path.join(root, process.argv[4]==='spa'?'index.html':'404.html'); }
 if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
 res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','cache-control':'public, max-age=31536000'}); fs.createReadStream(f).pipe(res);
}).listen(port,()=>console.log('ready',port));
