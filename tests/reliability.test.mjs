import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMachines,updateHistory} from '../scripts/collect.mjs';
import {reliabilityLabel,primaryDeviceState} from '../public/model.js';

test('reliability is a validated Vast ratio and verification is an explicit known state',()=>{
 const now=Date.parse('2026-10-30T17:00Z');
 for(const [raw,expected] of [[.9999,.9999],[0,0],[1,1],[undefined,null],[null,null],[-1,null],[1.01,null],['0.99',null],[NaN,null]]){
  const sample=sanitizeMachines([{id:123,reliability2:raw,verification:'verified'}],{123:'Box'})[0];
  const saved=updateHistory({boxes:[]},[sample],now).boxes[0].lastSample;
  assert.equal(sample.reliability,expected);assert.equal(saved.reliability,expected);assert.equal(saved.verification,'verified');
 }
 for(const state of ['verified','unverified','deverified',null,undefined,'unexpected']){
  const sample=sanitizeMachines([{id:123,verification:state}],{123:'Box'})[0];
  assert.equal(sample.verification,['verified','unverified','deverified'].includes(state)?state:null);
 }
});

test('compact reliability formatting preserves small differences without rounding imperfect scores to 100%',()=>{
 assert.equal(reliabilityLabel(.9999),'99.99%');assert.equal(reliabilityLabel(.975),'97.50%');
 assert.equal(reliabilityLabel(.999999),'<100%');assert.equal(reliabilityLabel(1),'100%');assert.equal(reliabilityLabel(0),'0.00%');
 for(const value of [null,undefined,NaN,-1,2])assert.equal(reliabilityLabel(value),'—');
});

test('one primary status prioritizes offline, running, listed and online',()=>{
 assert.equal(primaryDeviceState({connection:'offline',running:true,listed:true}),'offline');
 assert.equal(primaryDeviceState({connection:'online',running:true,listed:true}),'running');
 assert.equal(primaryDeviceState({connection:'online',running:true,listed:false}),'running');
 assert.equal(primaryDeviceState({connection:'online',running:false,listed:true}),'listed');
 assert.equal(primaryDeviceState({connection:'online',running:false,listed:false}),'online');
 assert.equal(primaryDeviceState({connection:'online',running:null,listed:null}),'online');
 assert.equal(primaryDeviceState({connection:'unknown',running:null,listed:null}),'unknown');
});

