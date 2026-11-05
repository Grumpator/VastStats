// Absolute deadlines avoid drift; missed ticks coalesce into one future check.
export class ScheduledJob {
  constructor({interval,task,now=Date.now,timers=globalThis,onChange=()=>{}}){
    this.interval=interval;this.task=task;this.now=now;this.timers=timers;this.onChange=onChange;
    this.state={running:false,lastAttempt:null,lastSuccess:null,lastFailure:null,failed:false,nextRun:null};this.stopped=false;this.pending=null;
  }
  async run(){
    if(this.stopped)return;if(this.pending)return this.pending;
    this.state.running=true;this.state.lastAttempt=new Date(this.now()).toISOString();this.onChange();
    this.pending=(async()=>{
      try{const result=await this.task();this.state.lastSuccess=new Date(this.now()).toISOString();this.state.failed=false;this.state.partial=!!result?.partial;}
      catch{this.state.lastFailure=new Date(this.now()).toISOString();this.state.failed=true;}
      finally{this.state.running=false;this.onChange();}
    })();
    try{await this.pending;}finally{this.pending=null;}
  }
  start(){
    this.deadline=this.now()+this.interval;
    const tick=()=>{
      if(this.stopped)return;
      const time=this.now();if(time>=this.deadline){void this.run();this.deadline+=Math.max(1,Math.floor((time-this.deadline)/this.interval)+1)*this.interval;}
      this.state.nextRun=new Date(this.deadline).toISOString();
      this.timer=this.timers.setTimeout(tick,Math.max(1,this.deadline-this.now()));this.timer?.unref?.();
    };tick();
  }
  async stop(){this.stopped=true;this.timers.clearTimeout(this.timer);this.state.nextRun=null;await this.pending;}
}
