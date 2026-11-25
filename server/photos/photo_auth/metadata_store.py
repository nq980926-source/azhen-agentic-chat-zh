import sqlite3
from contextlib import contextmanager, closing
from pathlib import Path
DDL="""
CREATE TABLE IF NOT EXISTS intents(
 owner TEXT, op TEXT, photo TEXT UNIQUE NOT NULL, object_key TEXT UNIQUE NOT NULL,
 batch TEXT, bytes INTEGER, params TEXT, state TEXT, integrity TEXT,
 binding TEXT, bucket TEXT, region TEXT, created REAL, updated REAL, lease REAL, PRIMARY KEY(owner,op));
CREATE TABLE IF NOT EXISTS events(owner TEXT,kind TEXT,stamp REAL,day TEXT,bytes INTEGER,op TEXT);
CREATE INDEX IF NOT EXISTS events_rate ON events(owner,kind,stamp);
PRAGMA user_version=1;
"""
class Store:
 def __init__(self,path):
  self.path=Path(path)
  self.path.parent.mkdir(parents=True,exist_ok=True)
  with closing(self.connect()) as c:
   version=c.execute("PRAGMA user_version").fetchone()[0]
   if version not in (0,1): raise ValueError("unsupported database schema")
   c.executescript(DDL)
 def connect(self):
  c=sqlite3.connect(self.path,timeout=10,isolation_level=None)
  c.row_factory=sqlite3.Row
  c.execute("PRAGMA journal_mode=WAL")
  c.execute("PRAGMA synchronous=FULL")
  return c
 @contextmanager
 def transaction(self):
  c=self.connect()
  try:
   c.execute("BEGIN IMMEDIATE")
   yield c
   c.commit()
  except BaseException:
   c.rollback()
   raise
  finally:c.close()
 def backup(self,destination):
  """SQLite backup API includes committed WAL; never copy live main file alone."""
  if Path(destination).exists(): raise ValueError("backup destination exists")
  src=self.connect(); dst=sqlite3.connect(destination)
  try:src.backup(dst)
  finally:dst.close();src.close()
 @staticmethod
 def restore(backup,destination):
  if Path(destination).exists(): raise ValueError("restore destination exists")
  src=sqlite3.connect(f"file:{Path(backup).as_posix()}?mode=ro",uri=True)
  try:
   if src.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("invalid backup")
   dst=sqlite3.connect(destination)
   try:src.backup(dst)
   finally:dst.close()
  finally:src.close()
