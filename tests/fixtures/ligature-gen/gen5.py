import sys, os
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'gen.py')).read()
ns={'sys':sys}; exec(src.split("B = bar(0,6000)")[0].replace("out = sys.argv[1]","out = %r" % sys.argv[1]), ns)
for lead,tag in (('f','lig'),('x','x')):
    for gap in (0.1,0.15,0.2,0.3,0.5,0.7):
        ns['write'](f'v5-{tag}-gap{int(gap*100):03d}', lead, 'i', ns['bar'](0,6000), secret_xy=(75+10*gap,600))
