import type { AiInput } from '../shared/collaboration';

/** Interprets a protection text the student wrote. Claude never drafts designs or protections. */
export async function requestClaude(input:Omit<AiInput,'id'>){
  const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,id:crypto.randomUUID()})});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error??'Claude no está disponible.');return data.proposal;
}
