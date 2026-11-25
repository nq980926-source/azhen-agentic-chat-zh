from typing import Protocol
class CosUnavailable(Exception): pass
class CosMissing(Exception): pass
class CosAdapter(Protocol):
 """Authorization server never sends image bytes through this port.
 The Tencent implementation uses official SDK signatures.
 """
 def sign(self, method:str,key:str,expires:float,headers:dict)->str: ...
 def head(self,key:str)->dict: ...
