const {admit}=require('./remote-ops-limits');
test('per-owner budgets reserve cancellation and recover at the window boundary',()=>{
  const owner='limits-test';for(let i=0;i<60;i++)expect(admit(owner,'remote-ops',{now:1000})).toBe(0);
  expect(admit(owner,'remote-ops',{now:1001})).toBe(60);
  for(let i=0;i<6;i++)expect(admit(owner,'remote-ops-cancel',{max:6,now:1001})).toBe(0);
  expect(admit(owner,'remote-ops-cancel',{max:6,now:1001})).toBe(60);
  expect(admit(owner,'remote-ops',{now:61001})).toBe(0);
});
