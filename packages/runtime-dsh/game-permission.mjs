/** Read live native session policy; saved GameGuy task fields are not authority. */
export function gamePermissionSnapshot(ctx,agent){
 if(!agent?.session)throw Error('Live task session unavailable');
 const session=agent.session;
 return {sessionId:session.id,preset:ctx.permissionPresets.current(session),sandboxMode:ctx.sandboxPolicy.resolve({session}).mode,approvalPolicy:ctx.approval.effectivePolicy(session)};
}
