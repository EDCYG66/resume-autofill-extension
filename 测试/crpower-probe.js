(async function(){
 'use strict';
 var out=document.getElementById('crpower-result');if(!out){out=document.createElement('pre');out.id='crpower-result';document.body.appendChild(out);}
 try{
var profile={basic:{name:'申请人测试',birth_date:'2001-06-03',nationality:'中国大陆',id_type:'身份证'},education:[{level:'硕士',school:'学校甲',start_date:'2024-09',major:'电子信息类',major_rank:'5%-20%',gpa:'3.7',gpa_max:'4.5'},{level:'本科',school:'学校乙',start_date:'2020-09'}],employment:[{start_date:'2023-07',end_date:'2023-08',employer:'实习测试单位',description:'实习测试描述'}],family:[{name:'家属甲',relation:'父亲',birth_date:'1960-02-03',employer:'家属单位甲',role:'家属岗位甲'},{name:'家属乙',relation:'母亲',birth_date:'1961-04-05',employer:'家属单位乙',role:'家属岗位乙'}],projects:[{name:'项目甲',duties:['项目职责甲']},{name:'项目乙',duties:['项目职责乙']}],additional:{relatives_in_company:'否'},self_evaluation:'测试自我评价'};
 profile.basic.current_residence='辽宁省/大连市';
 var before=ResumeContent.scan(profile);
 var expected=[['个人基本信息',0,'姓名','basic.name'],['个人基本信息',0,'出生日期','basic.birth_date'],['个人基本信息',0,'国籍/地区','basic.nationality'],['个人基本信息',0,'证件类型','basic.id_type'],['个人基本信息',0,'专业排名','education.1.major_rank'],['个人基本信息',0,'绩点成绩','education.1.gpa'],['个人基本信息',0,'您有无亲属在华润电力工作','additional.relatives_in_company'],['实习经历',0,'实习单位','employment.1.employer'],['实习经历',0,'实习描述','employment.1.description'],['家庭关系',0,'姓名','family.1.name'],['家庭关系',0,'亲属关系','family.1.relation'],['家庭关系',0,'出生日期','family.1.birth_date'],['家庭关系',0,'职务或岗位','family.1.role'],['教育经历',0,'学校名称','education.1.school'],['教育经历',1,'学校名称','education.2.school'],['教育经历',0,'开始时间','education.1.start_date'],['教育经历',1,'开始时间','education.2.start_date'],['项目经验',0,'项目名称','projects.1.name'],['项目经验',1,'项目名称','projects.2.name'],['自我评价',0,'评价内容','self_evaluation']];
 var snapshotChecks=expected.map(function(e){var match=before.filter(function(c){return c.sectionName===e[0]&&c.recordIndex===e[1]+1&&c.fieldLabel===e[2];});return {field:e.join('|'),ok:match.length===1&&match[0].profileKey===e[3]};});
 var summary={count:before.length,snapshotCorrect:snapshotChecks.filter(function(c){return c.ok;}).length,snapshotChecks:snapshotChecks,labels:before.map(function(c){return {label:c.label,key:c.profileKey,scope:c.scope,type:c.controlType};})};
 if(window.testSections){
  var results=await ResumeContent.fill(before.filter(function(c){return c.proposedValue&&c.confidence==='high'&&!c.sensitive;}));
  var checks=expected.map(function(e){var match=before.filter(function(c){return c.sectionName===e[0]&&c.recordIndex===e[1]+1&&c.fieldLabel===e[2];});return {field:e.join('|'),ok:match.length===1&&match[0].profileKey===e[3],key:match[0]&&match[0].profileKey};});
  var rows=Array.from(document.querySelectorAll('.form-cell'));
  function value(section,row,label){var cell=rows.find(function(c){return c.querySelector('.tit').textContent.replace('必填','')===section;});var inner=cell.querySelectorAll('.form-cell-inner')[row];var item=Array.from(inner.querySelectorAll('.ant-form-item')).find(function(i){return i.querySelector('label').textContent.replace('*','')===label;});var input=item.querySelector('input:not(.ant-select-search__field),textarea');return input?input.value:item.querySelector('.ant-select-selection-selected-value').textContent;}
  var noFamily=ResumeContent.scan(Object.assign({},profile,{family:[]}));
  var noWrongFamily=noFamily.filter(function(c){return c.sectionName==='家庭关系';}).every(function(c){return !c.profileKey;});
  var rank=before.find(function(c){return c.profileKey==='education.1.major_rank';});
  var absent=await ResumeContent.fill([Object.assign({},rank,{proposedValue:'前10%'})]);
  summary.checks=checks;summary.correct=checks.filter(function(c){return c.ok;}).length;summary.failed=results.filter(function(r){return r.status==='failed';});summary.noWrongFamily=noWrongFamily;
  summary.familyValues=[value('家庭关系',0,'姓名'),value('家庭关系',1,'姓名'),value('家庭关系',0,'亲属关系')];summary.schoolValues=[value('教育经历',0,'学校名称'),value('教育经历',1,'学校名称')];
  summary.internship=value('实习经历',0,'实习单位');summary.majorValue=value('个人基本信息',0,'专业');summary.majorCommitted=window.commits['个人基本信息|0|专业'];summary.dateCommitted=window.commits['个人基本信息|0|出生日期'];
  summary.rankMissingFailed=absent[0].status==='failed';summary.rankUnchanged=value('个人基本信息',0,'专业排名')==='5%-20%';summary.submits=window.submits;
  summary.residenceCommitted=window.commits['residence|0']==='辽宁省'&&window.commits['residence|1']==='大连市';
  summary.firstDegreeNotInferred=before.filter(function(c){return c.fieldLabel==='是否第一学历';}).every(function(c){return !c.profileKey;});
  var noGpaProfile=Object.assign({},profile,{education:[Object.assign({},profile.education[0],{gpa:''}),profile.education[1]]});
  summary.noMaximumAsGpa=ResumeContent.scan(noGpaProfile).filter(function(c){return c.fieldLabel==='绩点成绩';}).every(function(c){return !c.profileKey;});
  var detached=before.find(function(c){return c.profileKey==='family.2.name';});
  var familyCell=rows.find(function(c){return c.querySelector('.tit').textContent.replace('必填','')==='家庭关系';});
  familyCell.querySelectorAll('.form-cell-inner')[1].remove();
  var detachedResult=await ResumeContent.fill([detached]);
  summary.detachedRecordSafe=detachedResult[0].status!=='filled'&&value('家庭关系',0,'姓名')==='家属甲';
 }
 out.textContent=JSON.stringify(summary);
 }catch(e){out.textContent=JSON.stringify({error:String(e.stack||e)});}
}());
