from datetime import datetime,timezone,timedelta
from .schema import Problem
HK=timezone(timedelta(hours=8))
def day(now):return datetime.fromtimestamp(now,HK).date().isoformat()
def event(c,owner,kind,now,size=0,op=""):
 c.execute("INSERT INTO events VALUES(?,?,?,?,?,?)",(owner,kind,now,day(now),size,op))
def rate(c,owner,kind,now,window,maximum,op=None):
 sql="SELECT count(*) FROM events WHERE owner=? AND kind=? AND stamp>?"
 args=[owner,kind,now-window]
 if op is not None:sql+=" AND op=?";args.append(op)
 if c.execute(sql,args).fetchone()[0]>=maximum:raise Problem(429,"rate_limited")
def daily(c,owner,kind,now,count_limit,byte_limit,size):
 row=c.execute("SELECT count(*),coalesce(sum(bytes),0) FROM events WHERE owner=? AND kind=? AND day=?",(owner,kind,day(now))).fetchone()
 if row[0]>=count_limit or row[1]+size>byte_limit:raise Problem(429,"daily_quota")
