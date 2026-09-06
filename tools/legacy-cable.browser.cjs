const fs=require('node:fs'),path=require('node:path');
let playwright;try{playwright=require('playwright');}catch{playwright=require('C:/Users/vikra/OneDrive/Documents/GitHub/gridatlas-main-202609050200/node_modules/playwright');}
const out=path.resolve(process.env.TEST_OUTPUT||'legacy-cable-artifacts'),base=process.argv[2];
fs.mkdirSync(out,{recursive:true});const reports=[];
(async()=>{const browser=await playwright.chromium.launch();
 try{for(const width of [393,1440]){
  const context=await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
  const report={width,checks:[],errors:[]};reports.push(report);
  const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',width,name);};
  page.on('pageerror',e=>report.errors.push(e.message));
  const snapshot=async()=>JSON.parse(await page.locator('#snapshot_box').innerText());
  try{
   await page.goto(base,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.querySelector('#snapshot_box')?.textContent.includes('derived_geometry'));
   const drawn=()=>page.evaluate(()=>[...document.querySelectorAll('canvas')].map(c=>({id:c.id,drawn:c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v=>v!==0)})));
   check('All three original geometry canvases draw', (await drawn()).length===3&&(await drawn()).every(c=>c.drawn));
   await page.locator('#route_name').fill('Syntax recovery boundary');
   for(const [id,value] of Object.entries({cable_od:'50',circuit_qty:'5',max_per_row:'2',spacing_h:'100',spacing_v:'150',bend_factor:'15'}))await page.locator('#'+id).fill(value);
   await page.locator('#route_name').click();
   await page.waitForFunction(()=>JSON.parse(document.querySelector('#snapshot_box').textContent).inputs.cable_outer_diameter_mm===50);
   let state=await snapshot(),g=state.derived_geometry;
   check('Uneven rows retain every group',JSON.stringify(g.row_group_counts)==='[2,2,1]');
   check('Trefoil envelope matches independent geometry',Math.abs(g.worst_case_formation_width_mm-300)<1e-9&&Math.abs(g.worst_case_formation_depth_mm-(3*(50+Math.sqrt(3)*25)+300))<1e-9,g);
   check('Single-cable bend uses OD factor and half-OD outer sweep',g.applied_bend_radius_mm===750&&g.single_cable_outer_sweep_radius_mm===775);
   await page.locator('#formation_type').selectOption('flat_single_row');
   state=await snapshot();check('Flat formation changes actual exported envelope',state.derived_geometry.worst_case_formation_width_mm===400&&state.derived_geometry.worst_case_formation_depth_mm===450);
   await page.locator('#spacing_basis').selectOption('touching');
   state=await snapshot();check('Touching mode removes inter-group clear gaps',state.derived_geometry.worst_case_formation_width_mm===300&&state.derived_geometry.worst_case_formation_depth_mm===150);
   await page.locator('#spacing_basis').selectOption('centre_to_centre');
   await page.locator('#spacing_h').fill('25');await page.locator('#route_name').click();
   state=await snapshot();check('Spacing below OD is explicitly flagged',state.review.input_conflicts.some(s=>s.includes('Horizontal centre to centre'))&&state.derived_geometry.effective_horizontal_clear_gap_mm===0);
   const pending=page.waitForEvent('download');await page.locator('#export_btn').click();const download=await pending;
   const filename=path.join(out,width+'-export.json');await download.saveAs(filename);const exported=JSON.parse(fs.readFileSync(filename,'utf8'));
   check('Actual JSON export retains edited route and geometry',exported.route_id==='Syntax recovery boundary'&&exported.derived_geometry.worst_case_formation_width_mm===300);
   check('Original indicative-design limitations remain in export',exported.not_for_construction===true&&exported.assumptions.bend_model_basis==='single_cable_body_sweep_only');
   await page.locator('#copy_btn').click();const copied=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
   check('Copy Snapshot copies the actual current inputs',copied.inputs.cable_outer_diameter_mm===50&&copied.route_id===exported.route_id);
   await page.locator('#drawing_view_btn').click();check('Drawing View opens without blanking canvases',await page.locator('body').evaluate(e=>e.classList.contains('drawing-view'))&&(await drawn()).every(c=>c.drawn));
   await page.locator('#exit_drawing_view').click();check('Drawing View returns to editing',!(await page.locator('body').evaluate(e=>e.classList.contains('drawing-view'))));
   check('Exit returns keyboard focus to the original toggle',await page.locator('#drawing_view_btn').evaluate(e=>e===document.activeElement));
   await page.locator('#drawing_view_btn').click();await page.keyboard.press('Escape');check('Escape also leaves Drawing View',!(await page.locator('body').evaluate(e=>e.classList.contains('drawing-view'))));
   check('No uncaught script errors',report.errors.length===0,report.errors);
   await page.screenshot({path:path.join(out,width+'.png'),fullPage:true});
  }catch(error){report.error=error.stack;check('Legacy cable interaction completes',false,error.message);}
  finally{await context.close();}
 }}finally{await browser.close();}
})().catch(error=>{reports.push({error:error.stack});process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({base,reports},null,2)+'\n');if(reports.some(r=>r.error||r.checks?.some(c=>!c.pass)))process.exitCode=1;});
