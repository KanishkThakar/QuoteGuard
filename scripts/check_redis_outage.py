"""Explicit, reversible outage of one named local test Redis container."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit
import requests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--redis-container', required=True, help='Dedicated local test container only')
parser.add_argument('--base-url', default=os.environ.get('QUOTEGUARD_BASE_URL', 'http://127.0.0.1:8780'))
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[2]/'outputs/team-delivery/actual-redis-outage.json')
args = parser.parse_args()
if urlsplit(args.base_url).hostname not in {'127.0.0.1','localhost','::1'}:
    parser.error('Only loopback app URLs are allowed.')
redis_url = urlsplit(os.environ.get('REDIS_URL',''))
if redis_url.hostname not in {'127.0.0.1','localhost','::1'}:
    parser.error('Set REDIS_URL to the dedicated local Redis port used by the app.')
container = json.loads(subprocess.check_output(['docker','inspect',args.redis_container]))[0]
ports = container['NetworkSettings']['Ports'].get('6379/tcp') or []
if not container['State']['Running'] or not any(p['HostIp'] in {'127.0.0.1','::1'} and int(p['HostPort'])==(redis_url.port or 6379) for p in ports):
    parser.error('Named running container must publish the configured Redis port on loopback.')
base=args.base_url.rstrip('/')+'/api/'
s=requests.Session()
r=s.get(base+'auth/session/',timeout=10);r.raise_for_status();s.headers['X-CSRFToken']=r.json()['csrf']
r=s.post(base+'auth/login/',json={'username':'demo','password':'DemoQuoteGuard!2026'},timeout=10);r.raise_for_status();s.headers['X-CSRFToken']=r.json()['csrf']
r=s.get(base+'quotes/',timeout=10);r.raise_for_status();quotes=r.json()
q=next(q for q in quotes if q['status']=='draft' and q['currency']=='USD')
frozen={q['id']:q['snapshot'] for q in quotes if q['status']=='finalised'}
report={'checked_at':datetime.now(timezone.utc).isoformat(),'kind':'Actual named local Redis outage; response provenance below identifies provider mode','container':args.redis_container,'draft_quote_id':q['id']}
try:
    subprocess.run(['docker','stop',args.redis_container],check=True,stdout=subprocess.DEVNULL)
    r=s.get(base+'health/',timeout=10);r.raise_for_status();report['health_during_outage']=r.json()
    r=s.post(base+f"quotes/{q['id']}/calculate/",json={},timeout=15);r.raise_for_status();data=r.json()
    report['rate_provenance']=data['rate_provenance']
    assert report['health_during_outage']['redis']=='unavailable'
    assert data['rate_provenance'].get('redis_available') is False
    report['calculation_succeeded_without_cache']=True
finally:
    subprocess.run(['docker','start',args.redis_container],check=True,stdout=subprocess.DEVNULL)
    for _ in range(50):
        try:
            r=s.get(base+'health/',timeout=2);r.raise_for_status()
            if r.json()['redis']=='ok':break
        except requests.RequestException:pass
        time.sleep(.2)
    else:raise RuntimeError('Redis restart not verified')
    report['health_after_restart']=r.json()
r=s.get(base+'quotes/',timeout=10);r.raise_for_status()
report['finalised_snapshots_unchanged']=frozen=={q['id']:q['snapshot'] for q in r.json() if q['status']=='finalised'}
assert report['finalised_snapshots_unchanged']
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n')
print('PASS: named Redis outage, fallback calculation, restoration and immutable snapshots.')
