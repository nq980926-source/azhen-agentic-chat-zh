"""Offline SQLite backup/restore. No service import, listeners or COS requests."""
import argparse
import hashlib
import os
import sqlite3
import sys
from pathlib import Path

def snapshot(source,destination):
 source,destination=Path(source),Path(destination)
 if not source.is_file() or source.is_symlink():raise ValueError("source_required")
 # Exclusive creation: never overwrite a database or an existing backup.
 fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
 try:
  src=sqlite3.connect(source.resolve().as_uri()+"?mode=ro",uri=True)
  try:
   if src.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("source_integrity")
   dst=sqlite3.connect(destination)
   try:
    src.backup(dst)
    if dst.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("destination_integrity")
   finally:dst.close()
  finally:src.close()
  return hashlib.sha256(destination.read_bytes()).hexdigest()
 except BaseException:
  # Retain failed output for investigation; never delete data automatically.
  raise

def main(argv=None):
 parser=argparse.ArgumentParser(description="Consistent SQLite backup/restore to a NEW file; no COS")
 parser.add_argument("action",choices=["backup","restore"])
 parser.add_argument("--source",required=True);parser.add_argument("--destination",required=True)
 args=parser.parse_args(argv)
 try:
  digest=snapshot(args.source,args.destination)
  print(f"{args.action}_verified sha256={digest}");return 0
 except Exception:
  print("database_maintenance_failed_output_must_not_be_used",file=sys.stderr);return 2
if __name__=="__main__":sys.exit(main())
