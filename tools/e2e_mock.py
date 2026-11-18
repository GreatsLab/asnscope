"""Browser test with RIPEstat mocked out.

Serves the site, intercepts every stat.ripe.net request and answers with
made-up data in the documented response shapes, then looks up an IP and
saves screenshots. Needs playwright + a chrome:

    python3 -m http.server 8806 &
    CHROME=/usr/bin/google-chrome python3 tools/e2e_mock.py
"""
import asyncio, json, os, random, re, sys
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
random.seed(4)
NAMES = {"29465":"VCG-AS - MTN NIGERIA Communication limited, NG","37282":"MAINONE, NG","30844":"LIQUID-AS, GB","37100":"SEACOM-AS, MU","6939":"HURRICANE, US","3356":"LEVEL3, US","174":"COGENT-174, US","1299":"TWELVE99 Arelion, fka Telia Carrier, SE","328352":"Example ISP A, NG","327952":"Example ISP B, NG","37148":"GLOBACOM-AS, NG"}
def data_for(call, res):
    if call == "as-overview":
        return {"holder": NAMES.get(res, f"EXAMPLE-{res}, NG"), "announced": True, "resource": res, "type":"as"}
    if call == "announced-prefixes":
        pf = ["102.89.0.0/16","102.89.4.0/24","102.89.5.0/24","105.112.0.0/12","197.210.0.0/16","197.210.64.0/18","41.184.0.0/17","129.205.112.0/20","2c0f:f6d0::/32","2c0f:f6d0:4000::/36"]
        return {"query_endtime":"2026-11-18T08:00:00","prefixes":[{"prefix":p,"timelines":[{"starttime":"2026-11-04T08:00:00","endtime":"2026-11-18T08:00:00"}]} for p in pf]}
    if call == "asn-neighbours":
        left = [37282,30844,37100,6939,3356,174,1299,37148]
        right = [328352,327952,328000,328111,37650,36920]
        ns = [{"asn":a,"type":"left","power":random.randint(50,4000),"v4_peers":200,"v6_peers":20} for a in left]
        ns += [{"asn":a,"type":"right","power":random.randint(5,400),"v4_peers":200,"v6_peers":0} for a in right]
        ns.append({"asn":64496,"type":"uncertain","power":3,"v4_peers":1,"v6_peers":0})
        return {"neighbour_counts":{"left":8,"right":6,"uncertain":1,"unique":15},"neighbours":ns}
    if call == "network-info":
        return {"asns":["29465"],"prefix":"102.89.0.0/16"}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
        errs=[]
        for w,h,out in [(1360,1500,"shot-desktop.png"),(390,1600,"shot-mobile.png")]:
            pg = await b.new_page(viewport={"width":w,"height":h})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            async def route(r):
                u = urlparse(r.request.url); call = u.path.split("/")[2]; res = parse_qs(u.query)["resource"][0]
                await r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin":"*"}, body=json.dumps({"status":"ok","data":data_for(call,res)}))
            await pg.route("https://stat.ripe.net/**", route)
            await pg.route(re.compile(r"https://fonts\..*"), lambda r: r.abort())
            await pg.goto("http://localhost:8806/", wait_until="domcontentloaded")
            if w > 1000:
                await pg.screenshot(path="shot-intro.png")
            await pg.fill("#q", "102.89.4.10"); await pg.press("#q","Enter")
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=out, full_page=True)
            print(w, await pg.inner_text("#r-summary"))
            print("url:", pg.url, "scrollW", await pg.evaluate("document.documentElement.scrollWidth"))
        print("errors", errs)
        await b.close()
asyncio.run(main())
