#!/usr/bin/env python3
"""Local, credential-free review of the real Ops host and example reporting rows.
Run from the repo root: python3 scripts/sales-performance-preview.py
Open http://127.0.0.1:4187/ops.html#performance. No live requests or writes.
"""
import http.server
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / 'tests/fixtures/sales-performance-week.json').read_text())
STUB = r"""
window.__performancePreviewRequests=[];
window.SECUREWORKS_CLOUD={auth:{isLoggedIn:()=>true,getUser:()=>({id:'offline-review',name:'Review fixture',role:'admin'}),getAccessToken:async()=> 'offline-fixture-token'},on:()=>{},supabase:{channel:()=>({on(){return this},subscribe(){return this}})}};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin===location.origin)return originalFetch(input,options);
 if((options.method||'GET')!=='GET')throw Error('Offline preview refuses all writes');
 const action=url.searchParams.get('action');
 window.__performancePreviewRequests.push({action,week:url.searchParams.get('week_start'),authorization:options.headers?.Authorization});
 const result=action==='sales_performance_read'?FIXTURE:{jobs:[],crew:[],users:[],alerts:[],pipeline:[],rows:[]};
 return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
};
""".replace('FIXTURE', json.dumps(FIXTURE))

class Preview(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'self'; object-src 'none'")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ['/shared/cloud.js', '/shared/auth-gate.js']:
            body = (STUB if path.endswith('/cloud.js') else '// Offline auth fixture').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

if __name__ == '__main__':
    print('Offline Ops preview: http://127.0.0.1:4187/ops.html#performance', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', 4187), Preview).serve_forever()
