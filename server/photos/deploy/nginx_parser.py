def need(ok,code):
    if not ok: raise RuntimeError(code)

def parse(text):
    tokens=[]; i=0
    while i<len(text):
        if text[i].isspace(): i+=1; continue
        if text[i]=='#':
            j=text.find('\n',i); i=len(text) if j<0 else j+1; continue
        start=i
        if text[i] in ';{}': i+=1
        else:
            while i<len(text) and not text[i].isspace() and text[i] not in ';{}#':
                if text[i]=='\\': i+=2
                elif text[i] in ('"',"'"):
                    q=text[i]; i+=1
                    while i<len(text) and text[i]!=q:
                        i+=2 if text[i]=='\\' else 1
                    need(i<len(text),'UNBALANCED_QUOTES'); i+=1
                elif text.startswith('${',i):
                    j=text.find('}',i+2); need(j>=0,'UNBALANCED_VARIABLE'); i=j+1
                else: i+=1
        tokens.append((text[start:i],start,i))
    pos=0
    def level(nested=False):
        nonlocal pos
        nodes=[]; args=[]; start=None
        while pos<len(tokens):
            word,a,b=tokens[pos]; pos+=1
            if word=='}':
                need(nested and not args,'UNEXPECTED_CLOSE'); return nodes,b
            if start is None: start=a
            if word=='{':
                need(bool(args),'EMPTY_BLOCK'); children,end=level(True)
                nodes.append({'a':args,'start':start,'end':end,'open':a,'children':children})
                args=[]; start=None
            elif word==';':
                need(bool(args),'EMPTY_DIRECTIVE'); nodes.append({'a':args,'start':start,'end':b,'children':None})
                args=[]; start=None
            else: args.append(word[1:-1] if len(word)>1 and word[0]==word[-1] and word[0] in ('"',"'") else word)
        need(not nested and not args,'INCOMPLETE_CONFIG'); return nodes,len(text)
    return level()[0]
