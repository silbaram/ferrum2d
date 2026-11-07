import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { groundShadowCount, groundShadowRanges } from "../src/groundShadowRanges.js";

test("ground casters and upright alpha receivers preserve original indices across texture and ground gaps", () => {
  const buffer=new Float32Array(8*17);
  for(const [i,flags] of [4,12,20,0,36,4,36,0].entries()){
    buffer[i*17+12]=i===2?2:1;buffer[i*17+13]=flags;
  }
  const commands={buffer,commandCount:8,floatsPerCommand:17};
  equal(groundShadowCount(commands),4);
  const ranges=groundShadowRanges(commands,[]);
  deepEqual(ranges,[{textureId:1,start:1,end:2},{textureId:2,start:2,end:3},{textureId:1,start:4,end:5},{textureId:1,start:6,end:7}]);
  const first=ranges[0];
  deepEqual(groundShadowRanges(commands,ranges,true),[{textureId:1,start:3,end:4},{textureId:1,start:7,end:8}]);
  equal(ranges[0],first,"warm ranges reuse their records");
  deepEqual(groundShadowRanges({...commands,commandCount:0},ranges),[]);
});

test("legacy commands without effect flags contain only upright receivers",()=>{
  const commands={buffer:new Float32Array(26),commandCount:2,floatsPerCommand:13};
  equal(groundShadowCount(commands),0);
  deepEqual(groundShadowRanges(commands,[]),[]);
  deepEqual(groundShadowRanges(commands,[],true),[{textureId:0,start:0,end:2}]);
});
