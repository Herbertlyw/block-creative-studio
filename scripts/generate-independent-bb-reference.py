#!/usr/bin/env python3
"""Create an independent, deliberately simple CFR BB reference with known three-step truth.

No workbench renderer or gameplay library is imported. The output is a synthetic test,
not an original game asset. Refuses to overwrite an existing file.
"""
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

if len(sys.argv)!=2:
    raise SystemExit('Usage: generate-independent-bb-reference.py NEW_OUTPUT.mp4')
output=Path(sys.argv[1])
if output.exists():
    raise SystemExit('Output exists; refusing to overwrite it')
W,H,FPS,COUNT=512,864,30,151
# Design-to-output scaling matches the deliberately known calibration layout.
def pixel(x,y):return round(x*W/1080),round(y*H/1920)
def frame(index):
    data=bytearray(bytes((18,35,60))*W*H)
    def rect(x,y,w,h,color):
        x0=max(0,min(W,int(x)));y0=max(0,min(H,int(y)));x1=max(x0,min(W,int(x+w)));y1=max(y0,min(H,int(y+h)))
        row=bytes(color)*(x1-x0)
        for yy in range(y0,y1):data[(yy*W+x0)*3:(yy*W+x1)*3]=row
    def box(x,y,size,color):
        x0,y0=pixel(x,y);x1,y1=pixel(x+size,y+size);rect(x0,y0,x1-x0,y1-y0,color)
    boardx,boardy,pitch=60,300,100
    for r in range(8):
        for c in range(8):
            x,y=pixel(boardx+c*pitch,boardy+r*pitch);x2,y2=pixel(boardx+(c+1)*pitch,boardy+(r+1)*pitch);rect(x+1,y+1,x2-x-2,y2-y-2,(45,53,64))
    blue=(238,181,49);coral=(40,180,220);lime=(238,181,49)
    if index<27:
        for col in range(7):box(boardx+col*pitch,boardy,pitch,blue)
        if index>=21:box(boardx+7*pitch,boardy,pitch,blue)
    if index>=51:box(boardx+pitch,boardy+pitch,pitch,coral)
    if index>=81:box(boardx+2*pitch,boardy+pitch,pitch,lime)
    if index==27:
        x,y=pixel(boardx,boardy);x2,y2=pixel(boardx+8*pitch,boardy+pitch);rect(x,y,x2-x,y2-y,(240,240,240))
    steps=[(6,21,200,1400,760,300,70,100,blue),(36,51,200,1400,160,400,70,100,coral),(66,81,226,1379,260,400,70,100,lime)]
    for slot,(start,end,x0,y0,x1,y1,s0,s1,color) in enumerate(steps):
        if index<start:box([236,540,844][slot]-35,1415,70,color)
        elif index<end:
            t=(index-start)/(end-start);box(x0+(x1-x0)*t,y0+(y1-y0)*t,s0+(s1-s0)*t,color)
    # Explicit synthetic pointer center, independent of the moving block box.
    for start,end,*_ in steps:
        if start<=index<=end:
            t=(index-start)/(end-start);cx=round((.2+.3*t)*W);cy=round((.8-.5*t)*H)
            for dy in range(-10,11):
                for dx in range(-10,11):
                    if 49<=dx*dx+dy*dy<=100:rect(cx+dx,cy+dy,1,1,(255,255,255))
            break
    return data

with tempfile.TemporaryDirectory(prefix='bb-synthetic-reference-') as temp:
    wav=Path(temp)/'events.wav';rate=48000;length=round(COUNT/FPS*rate)
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate)
        samples=bytearray()
        for i in range(length):
            t=i/rate;value=0.025*math.sin(2*math.pi*180*t)
            for event,hz in [(0.7,740),(0.9,1120),(1.7,740),(2.7,740)]:
                dt=t-event
                if 0<=dt<.07:value+=.25*(1-dt/.07)*math.sin(2*math.pi*hz*dt)
            n=max(-32767,min(32767,round(value*32767)));samples+=struct.pack('<hh',n,n)
        f.writeframes(samples)
    proc=subprocess.Popen(['ffmpeg','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(wav),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-pix_fmt','yuv420p','-preset','medium','-crf','18','-c:a','aac','-b:a','192k','-t',str(COUNT/FPS),'-n',str(output)],stdin=subprocess.PIPE)
    assert proc.stdin is not None
    try:
        for i in range(COUNT):proc.stdin.write(frame(i))
    finally:proc.stdin.close()
    if proc.wait()!=0:raise SystemExit('FFmpeg failed; incomplete output was retained for diagnosis')
print(f'Created synthetic reference: {COUNT} frames, {FPS} fps, {W}x{H}; 3 actions and 1 row clear.')
