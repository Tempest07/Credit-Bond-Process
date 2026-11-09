import PizZip from 'pizzip';
import { Inflate, Zip, ZipDeflate } from 'fflate';
import { SaxesParser } from 'saxes';

export class InventoryError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const columns = {
  institution: '机构名称', branch: '联动分行', account: '会计分类', portfolio: '交易组合',
  scope: '表内/委外', code: '债券代码', name: '债券简称', principal: '名义本金',
  issuer: '发行人全称', marketType: '债券类型', date: '数据业务日期',
  maturity: '到期日期', expected: 'ABS预计到期日', legal: '法定到期日',
  attribution: '资产端损益还原客户名称', guarantor: '担保人',
};
const guarantorHeaders = new Set(['担保人','担保人全称','担保人名称','担保方','担保方全称','保证人','保证人全称','保证人名称']);
const required = ['date','code','name','principal','issuer','branch','scope','account','portfolio','institution'];
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
function dateOf(value, epoch1904) {
  let v = value;
  if (typeof v === 'number') v = new Date((v - (epoch1904 ? 24107 : 25569)) * 86400000);
  if (v instanceof Date && Number.isFinite(+v)) return v.toISOString().slice(0,10);
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?: 00:00:00)?$/.exec(text(v));
  if (!m) return '';
  const result = [m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-');
  const d = new Date(result+'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().startsWith(result) ? result : '';
}
function amount(value, sourceRow) {
  const raw = text(value);
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) {
    throw new InventoryError('第 '+sourceRow+' 行的名义本金为空、格式异常或超出人民币分的精度。');
  }
  const negative = raw.startsWith('-'), [integer, fraction=''] = raw.replace(/[+,\-]/g,'').split('.');
  const cents = Number(BigInt(integer)*100n+BigInt(fraction.padEnd(2,'0')));
  if (!Number.isSafeInteger(cents)) throw new InventoryError('名义本金超出可精确统计范围。');
  return negative ? -cents : cents;
}
const maxPartBytes = 100 * 1024 * 1024;
const maxWorkbookBytes = 128 * 1024 * 1024;
const malformed = () => new InventoryError('请上传可读取的 .xlsx 库存台账（解压后整表上限 128 MB，单个内部文件上限 100 MB）。');

// PizZip indexes the central directory. Inflate one part in small chunks so the
// worksheet XML, its object tree and the user rows are never held in memory together.
function readPart(zip, path, handlers) {
  const entry = zip.file(path)?._data;
  if (!entry) throw malformed();
  const parser = new SaxesParser();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let expanded = 0;
  parser.on('doctype', () => { throw malformed(); });
  parser.on('opentag', tag => handlers.open?.(tag.name.split(':').pop(), tag.attributes));
  parser.on('closetag', tag => handlers.close?.(tag.name.split(':').pop()));
  if (handlers.text) {
    parser.on('text', handlers.text);
    parser.on('cdata', handlers.text);
  }
  function consume(chunk) {
    expanded += chunk.length;
    if (expanded > entry.uncompressedSize || expanded > maxPartBytes) throw malformed();
    parser.write(decoder.decode(chunk, { stream: true }));
  }
  const compressed = entry.getCompressedContent();
  const stored = entry.compressionMethod === '\0\0';
  if (!stored && entry.compressionMethod !== '\x08\0') throw malformed();
  const inflater = stored ? null : new Inflate(consume);
  for (let i = 0; i < compressed.length; i += 8192) {
    const part = compressed.subarray(i, i + 8192);
    if (stored) consume(part);
    else inflater.push(part, i + 8192 >= compressed.length);
  }
  if (expanded !== entry.uncompressedSize) throw malformed();
  parser.write(decoder.decode()).close();
}

function relationships(zip) {
  const parts = new Map();
  readPart(zip, 'xl/_rels/workbook.xml.rels', {
    open(name, attr) {
      if (name !== 'Relationship' || attr.TargetMode === 'External') return;
      const type = attr.Type?.split('/').pop();
      if (!['worksheet','sharedStrings'].includes(type)) return;
      if (!attr.Target || attr.Target.includes('\\') || attr.Target.includes(':')) throw malformed();
      const target = new URL(attr.Target,'https://xlsx.invalid/xl/workbook.xml');
      if (target.host !== 'xlsx.invalid' || target.search || target.hash) throw malformed();
      parts.set(attr.Id, { type, path: decodeURIComponent(target.pathname.slice(1)) });
    },
  });
  return parts;
}
function workbookInfo(zip, parts) {
  const sheets = [];
  let epoch1904 = false;
  readPart(zip, 'xl/workbook.xml', {
    open(name, attr) {
      if (name === 'workbookPr') epoch1904 = ['1','true'].includes(attr.date1904);
      if (name !== 'sheet' || ['hidden','veryHidden'].includes(attr.state)) return;
      const part = parts.get(attr['r:id']);
      if (part?.type === 'worksheet') sheets.push({ name: attr.name, path: part.path });
    },
  });
  return { sheets, epoch1904 };
}
function sharedStrings(zip, parts) {
  const part = [...parts.values()].find(p => p.type === 'sharedStrings');
  if (!part) return [];
  let string = '', inText = false, phonetic = false;
  const strings = [];
  readPart(zip, part.path, {
    open(name) {
      if (name === 'si') string = '';
      if (name === 'rPh') phonetic = true;
      if (name === 't') inText = !phonetic;
    },
    text(chunk) {
      if (!inText) return;
      string += chunk;
      if (string.length > 32767) throw malformed();
    },
    close(name) {
      if (name === 't') inText = false;
      if (name === 'rPh') phonetic = false;
      if (name === 'si') {
        if (strings.length >= 500000) throw new InventoryError('库存表的共享字符串超过单次导入上限。');
        strings.push(string);
      }
    },
  });
  return strings;
}
const requiredHeader = '每次需有一张可识别的库存明细工作表，含业务日期、名义本金、机构、联动分行、会计分类、交易组合、表内/委外、券码、简称和发行人全称。';
function snapshotSheet(zip, sheet, strings, epoch1904, sourceKeys) {
  let sourceFields = [], projected = [];
  let sourceRow = 0, column = 0, cellType = '', value = '', capture = false, inCell = false, phonetic = false;
  let values = new Map(), header = null, date = '', totalCents = 0, absoluteCents = 0;
  let guarantorHeader = '';
  const headerMissing = Symbol('skip worksheet');
  const rows = [];
  function closeRow() {
    if (!header) {
      const idx = {}, duplicates = new Set();
      for (const [col,v] of values) for (const [field, label] of Object.entries(columns)) {
        if (field === 'guarantor' ? !guarantorHeaders.has(text(v)) : text(v) !== label) continue;
        if (field in idx) duplicates.add(field);
        idx[field] = col;
      }
      if (!required.every(k => k in idx)) return;
      if (duplicates.size) throw new InventoryError('库存表头含重复字段，请先核对。');
      header = idx;
      if (sourceKeys) {
        const known = new Set(Object.values(idx)), names = new Set(), duplicates = new Set();
        for (const [col, raw] of values) {
          const label = text(raw);
          if (known.has(col) || !label || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) continue;
          if (names.has(label)) duplicates.add(label);
          names.add(label);
          sourceFields.push({key:'原表:'+label,col});
        }
        sourceFields = sourceFields.filter(({key})=>!duplicates.has(key.slice(3)));
        projected = sourceFields.filter(({key})=>sourceKeys.has(key));
      }
      guarantorHeader = text(values.get(idx.guarantor));
      return;
    }
    if (!values.size) return;
    const read = name => values.get(header[name]);
    if (!text(read('code')) && !text(read('name')) && [...values.values()].some(v => /^(合计|小计|总计)$/.test(text(v)))) return;
    if (!text(read('code'))) throw new InventoryError('第 '+sourceRow+' 行缺少债券代码，请核对明细或汇总行。');
    if (rows.length>=30000) throw new InventoryError('单个库存快照上限为 30,000 条。');
    const rowDate = dateOf(read('date'), epoch1904);
    if (!rowDate || date && date !== rowDate) throw new InventoryError('库存表必须是同一业务日的完整快照，请核对第 '+sourceRow+' 行的日期。');
    date = rowDate;
    const cents = amount(read('principal'), sourceRow);
    absoluteCents += Math.abs(cents);
    if (!Number.isSafeInteger(absoluteCents)) throw new InventoryError('快照累计金额超过精确统计范围。');
    totalCents += cents;
    const r = { sourceRow, cents };
    for (const field of ['institution','branch','account','portfolio','scope','code','name','issuer','marketType','guarantor','attribution']) r[field] = text(read(field));
    for (const field of ['maturity','expected','legal']) r[field] = dateOf(read(field),epoch1904);
    for (const {key,col} of projected) {
      const v = values.get(col), label = key.slice(3);
      r[key] = v == null ? '' : typeof v === 'number' && /(?:日期|到期日|行权日|起息日|发行日)$/.test(label)
        ? dateOf(v,epoch1904) : v;
    }
    rows.push(r);
  }
  try {
    readPart(zip, sheet.path, {
      open(name, attr) {
        if (name === 'row') {
          const next = attr.r ? Number(attr.r) : sourceRow + 1;
          if (!Number.isSafeInteger(next) || next <= sourceRow) throw malformed();
          sourceRow = next;
          if (!header && sourceRow > 20) throw headerMissing;
          values.clear();
          column = 0;
        } else if (name === 'c') {
          inCell = true; cellType = attr.t || 'n'; value = ''; capture = false;
          if (attr.r) {
            const ref = /^([A-Z]{1,3})(\d+)$/.exec(attr.r);
            if (!ref || Number(ref[2]) !== sourceRow) throw malformed();
            column = 0;
            for (const ch of ref[1]) column = column * 26 + ch.charCodeAt(0) - 64;
          } else column++;
        } else if (inCell) {
          if (name === 'rPh') phonetic = true;
          if (name === 'v' || name === 't' && cellType === 'inlineStr' && !phonetic) capture = true;
        }
      },
      text(chunk) { if (capture) value += chunk; },
      close(name) {
        if (name === 'v' || name === 't') capture = false;
        if (name === 'rPh') phonetic = false;
        if (name === 'c') {
          inCell = false;
          if (value === '') return;
          let v = value;
          if (cellType === 's') {
            if (!/^\d+$/.test(value) || Number(value) >= strings.length) throw malformed();
            v = strings[Number(value)];
          } else if (cellType === 'n') {
            v = Number(value);
            if (!Number.isFinite(v)) throw malformed();
          } else if (cellType === 'd') {
            const day = new Date(value);
            v = Number.isFinite(+day) ? day.toISOString().slice(0,10) : '';
          } else if (cellType === 'b' && sourceKeys && projected.some(field=>field.col===column)) {
            v = value === '1' ? 'TRUE' : 'FALSE';
          } else if (cellType === 'e' || cellType === 'b') {
            v = '';
          }
          values.set(column, v);
        }
        if (name === 'row') closeRow();
      },
    });
  } catch (error) { if (error === headerMissing) return null; throw error; }
  if (!header) return null;
  return { rows, date, rowCount: rows.length, totalCents, sheet: sheet.name,
    ...(sourceKeys ? {sourceFields:sourceFields.map(field=>field.key)} : {}),
    guarantorHeader, hasAttribution: 'attribution' in header };
}
// Some weekly workbooks retain a smaller, visible extract of the current ledger.
function holdingKey(row) {
  return JSON.stringify([row.code,row.name,row.cents,row.portfolio,row.institution,row.branch,row.account,row.scope,row.issuer]);
}
function isLedgerExtract(ledger,candidate) {
  if (ledger.sheet.trim()!=='本期底稿' || ledger.date!==candidate.date || ledger.rowCount<=candidate.rowCount) return false;
  const needed=new Map();
  for (const row of candidate.rows) {
    const key=holdingKey(row);
    needed.set(key,(needed.get(key) || 0)+1);
  }
  for (const row of ledger.rows) {
    const key=holdingKey(row), n=needed.get(key);
    if (n===1) needed.delete(key);
    else if (n>1) needed.set(key,n-1);
    if (!needed.size) break;
  }
  return !needed.size;
}
export async function parseInventoryWorkbook(bytes, sourceKeys) {
  try {
    const zip = new PizZip(bytes);
    const entries = Object.values(zip.files);
    const expanded = entries.reduce((sum,e) => sum + (e._data?.uncompressedSize || 0),0);
    if (entries.length>3000 || expanded>maxWorkbookBytes || entries.some(e=>/vbaProject\.bin$/i.test(e.name))) throw malformed();
    const parts = relationships(zip), { sheets, epoch1904 } = workbookInfo(zip, parts), strings = sharedStrings(zip, parts);
    let found = null;
    // Validate the designated ledger before accepting other recognized sheets as extracts.
    const ordered=[...sheets].sort((a,b)=>Number(b.name.trim()==='本期底稿')-Number(a.name.trim()==='本期底稿'));
    for (const sheet of ordered) {
      const candidate = snapshotSheet(zip, sheet, strings, epoch1904, sourceKeys);
      if (!candidate) continue;
      if (found) {
        if (isLedgerExtract(found,candidate)) continue;
        throw new InventoryError(requiredHeader);
      }
      found = candidate;
    }
    if (!found) throw new InventoryError(requiredHeader);
    if (!found.rowCount) throw new InventoryError('工作表没有可导入的库存记录。');
    return found;
  } catch (error) { if (error instanceof InventoryError) throw error; throw malformed(); }
}

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const worksheetNames = ['分组汇总','持仓明细','计算口径'];
const styles = '<styleSheet xmlns="'+ns+'"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00000000"/></numFmts>'+
  '<fonts count="3"><font><sz val="11"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/></font><font><b/><sz val="11"/></font></fonts>'+
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF265A4C"/></patternFill></fill></fills>'+
  '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="7">'+[[0,0,0],[1,2,0],[0,0,164],[0,0,165],[2,0,0],[2,0,164],[2,0,165]].map(([font,fill,num])=>'<xf xfId="0" fontId="'+font+'" fillId="'+fill+'" numFmtId="'+num+'" borderId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>').join('')+
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const encode = new TextEncoder();
const escapeText = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function metadata(zipPart, names=worksheetNames) {
  const files = names.map((name,i)=>({ name, number:i+1, id:'rId'+(i+1) }));
  zipPart('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+files.map(s=>'<Override PartName="/xl/worksheets/sheet'+s.number+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>');
  const relHead = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  zipPart('_rels/.rels',relHead+'<Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zipPart('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets>'+files.map(s=>'<sheet name="'+s.name+'" sheetId="'+s.number+'" r:id="'+s.id+'"/>').join('')+'</sheets></workbook>');
  zipPart('xl/_rels/workbook.xml.rels',relHead+files.map(s=>'<Relationship Id="'+s.id+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+s.number+'.xml"/>').join('')+'<Relationship Id="rId4" Type="'+rel+'/styles" Target="styles.xml"/></Relationships>');
  zipPart('xl/styles.xml',styles);
}
function columnName(index) {
  let name='';
  for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
  return name;
}
function rowXml(number,values,formats=[],bold=false) {
  const attrs = number===1 ? ' ht="23" customHeight="1"' : '';
  const cells=values.map((v,i)=>{
    const format=number===1 ? 1 : bold ? ({2:5,3:6}[formats[i]] || 4) : formats[i] || 0;
    const attr=' r="'+columnName(i)+number+'" s="'+format+'"';
    return typeof v==='number' ? '<c'+attr+'><v>'+v+'</v></c>' : '<c'+attr+' t="inlineStr"><is><t xml:space="preserve">'+escapeText(v)+'</t></is></c>';
  });
  return '<row r="'+number+'"'+attrs+'>'+cells.join('')+'</row>';
}
function writeSheet(zip,index,{headers,widths,formats=[],rows,total,filter=false}) {
  const entry = new ZipDeflate('xl/worksheets/sheet'+index+'.xml',{level:1});
  zip.add(entry);
  let chunk = xml+'<worksheet xmlns="'+ns+'"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+
    widths.map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>').join('')+'</cols><sheetData>'+rowXml(1,headers);
  let number=1;
  for(const row of rows) {
    chunk += rowXml(++number,row,formats);
    if(chunk.length>=32768){entry.push(encode.encode(chunk),false);chunk='';}
  }
  const lastColumn=columnName(headers.length-1);
  if(total)chunk += rowXml(number+1,total,formats,true);
  chunk+='</sheetData>'+(filter?'<autoFilter ref="A1:'+lastColumn+number+'"/>':'')+'</worksheet>';
  entry.push(encode.encode(chunk),true);
}
export const inventoryDimensions=Object.freeze({issuer:'发行人',branch:'联动分行',portfolio:'交易组合',account:'会计科目',scope:'表内/委外',marketType:'债券类型',code:'券码',none:'合计'});
const columnLabel=field=>inventoryDimensions[field]??columns[field]??(field==='cents'?'名义本金（人民币分）':field?.replace(/^原表:/,''));
export function analysisMeasureLabel(measure) {
  if(measure.fn==='principalShare')return '名义本金占比（%）';
  const label=columnLabel(measure.field);
  const operation={distinct:'不同值数',sum:'合计',avg:'均值',min:'最小值',max:'最大值',weightedAvg:'本金加权均值'};
  return label+operation[measure.fn];
}
export async function exportInventoryWorkbook(result, rows) {
  const parts=[]; let length=0;
  const zip=new Zip((error,part)=>{
    if(error)throw error;
    parts.push(part);length+=part.length;
  });
  metadata((name,content)=>{
    const entry=new ZipDeflate(name,{level:1});
    zip.add(entry);entry.push(encode.encode(xml+content),true);
  });
  const {roleEvidence:evidence,snapshot,plan}=result;
  const hasQueryType=rows.some(row=>Object.hasOwn(row,'queryMarketType'));
  const hasQueryAccount=rows.some(row=>Object.hasOwn(row,'queryAccount'));
  const roleLabel=evidence?.basis==='enhancement'?'增信占用':({ledger:'台账列明担保',candidate:'归属候选（待核担保）',attribution:'客户归属',unknown:'无法确认担保'})[evidence?.kind]||'';
  const analysisFields=[...new Set((plan.analysis??[]).flatMap(step=>[step.field,step.measure?.field,...(step.fields??[])]))];
  const extraFields=analysisFields.filter(field=>field?.startsWith('原表:'));
  const roleDetails=Boolean(evidence)||analysisFields.includes('guarantor')||analysisFields.includes('attribution');
  const byCode=!plan.analysis&&plan.group==='code';
  const groupHeaders=result.dimensions?(result.dimensions.length?result.dimensions.map(columnLabel):['合计']):plan.rank?[inventoryDimensions[plan.rank.by],inventoryDimensions[plan.group]]:[roleLabel?roleLabel+'分组':'分组'];
  writeSheet(zip,1,{
    headers:[...groupHeaders,'名义本金（人民币元）','名义本金（亿元）','持仓行数','不同券数',...(byCode?['券名']:[]),...(result.measure?[analysisMeasureLabel(result.measure)]:[])],widths:[42,...groupHeaders.slice(1).map(()=>23),25,23,14,14,...(byCode?[29]:[]),...(result.measure?[27]:[])],formats:[...groupHeaders.map(()=>0),2,3],
    rows:result.groups.map(g=>[...(g.labels?(g.labels.length?g.labels:['全部']):plan.rank?[g.rankName,g.bucketName]:[g.name]),g.cents/100,g.cents/1e10,g.count,g.securityCount,...(byCode?[g.securityName]:[]),...(result.measure?[g.measureValue]:[])]),
    total:evidence?.kind==='unknown'?[result.summary]:[roleLabel?roleLabel+'合计':'全部匹配',...groupHeaders.slice(1).map(()=>''),result.totalCents/100,result.totalCents/1e10,result.rowCount,result.securityCount,...(result.measure?[result.measureTotal]:[])],filter:true,
  });
  function* details(){
    for(const r of rows)yield [r.issuer,r.code,r.name,r.cents/100,r.institution,r.branch,r.portfolio,r.account,r.scope,r.marketType,r.maturity,r.expected,r.legal,r.sourceRow,...(roleDetails?[r.attribution,r.guarantor]:[]),...(hasQueryType?[r.queryMarketType]:[]),...(hasQueryAccount?[r.queryAccount]:[]),...extraFields.map(field=>r[field])];
  }
  writeSheet(zip,2,{
    headers:['发行人','债券代码','债券简称','名义本金（人民币元）','机构','联动分行','交易组合','会计分类','表内/委外','债券类型','到期日期','ABS预计到期日','法定到期日','原表行号',...(roleDetails?['资产端损益还原客户名称','台账列明担保人']:[]),...(hasQueryType?['本次归集品种']:[]),...(hasQueryAccount?['本次会计科目']:[]),...extraFields.map(columnLabel)],
    widths:[40,19,29,25,22,17,25,15,16,22,18,18,18,12,...(roleDetails?[38,38]:[]),...(hasQueryType?[20]:[]),...(hasQueryAccount?[20]:[]),...extraFields.map(()=>23)],formats:[0,0,0,2],rows:details(),filter:true,
  });
  writeSheet(zip,3,{
    headers:['项目','内容'],widths:[24,94],
    rows:[['来源文件',snapshot.filename],['工作表',snapshot.sheet],['业务日期',snapshot.date],['快照版本',snapshot.id],['查询编号',result.resultId],['筛选与分组',JSON.stringify(plan)],...(result.scopedToPrevious?[['持仓范围','在上轮结果继承的原表持仓行内查询，完整入选行号见持仓明细。']]:[]),['金额口径','人民币元。数据库按分精确合计，1亿元 = 100,000,000元。'],...(plan.rank?[['排名口径',result.rankReused?'沿用上次排名的主体名单和顺序，在其中按本轮条件筛选统计。':'按筛选范围内的名义本金从高到低取前 '+plan.rank.limit+' 个'+inventoryDimensions[plan.rank.by]+'，同额按名称顺序取舍。合计仅含入选持仓。']]:[]),['覆盖提示',result.warnings.join('；')],...(evidence?[['主体',evidence.entity],['归集依据',evidence.source],['本次结论',result.summary]]:[]),...(result.trace||[]).map(step=>['查证过程',step])],
  });
  zip.end();
  const bytes=new Uint8Array(length);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return bytes;
}

// Reuse the bounded XLSX reader and XML-safe exporter for transaction workbooks.
export {relationships,workbookInfo,sharedStrings,readPart,dateOf,amount,metadata,rowXml,columnName,maxPartBytes,maxWorkbookBytes};
