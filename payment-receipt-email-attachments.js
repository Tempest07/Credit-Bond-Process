import PostalMime from 'postal-mime';

const MAX_DEPTH=3,MAX_ATTACHMENTS=20,MAX_BYTES=25*1024*1024;
export class PaymentReceiptAttachmentLimitError extends Error{
  constructor(message,detail){super(message);this.name='PaymentReceiptAttachmentLimitError';this.detail=detail;}
}
const bytesOf=value=>value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;

/** Collect PDF attachments from one stored email, including forwarded .eml files. */
export async function collectPaymentReceiptPdfAttachments(raw){
  const input=bytesOf(raw);if(!input)throw Error('邮件不是可读取的二进制内容');
  if(input.byteLength>MAX_BYTES)throw new PaymentReceiptAttachmentLimitError('原始邮件超过 25 MiB 自动提取上限',{limit:'bytes',maxBytes:MAX_BYTES});
  const pdfs=[],attachmentSources=[];let attachmentCount=0,totalAttachmentBytes=0,nestedEmailCount=0;
  async function visit(source,depth,parents){
    const parsed=await PostalMime.parse(source);
    for(const attachment of parsed.attachments||[]){
      attachmentCount++;
      if(attachmentCount>MAX_ATTACHMENTS)throw new PaymentReceiptAttachmentLimitError('邮件附件总数超过 20 个自动提取上限',{limit:'attachments',attachmentCount,maxAttachments:MAX_ATTACHMENTS});
      const content=bytesOf(attachment.content);if(!content)throw Error('邮件附件不是可读取的二进制内容');
      totalAttachmentBytes+=content.byteLength;
      if(totalAttachmentBytes>MAX_BYTES)throw new PaymentReceiptAttachmentLimitError('邮件附件累计超过 25 MiB 自动提取上限',{limit:'bytes',totalAttachmentBytes,maxBytes:MAX_BYTES});
      const mimeType=String(attachment.mimeType||attachment.contentType||'application/octet-stream').toLowerCase(),filename=String(attachment.filename||`attachment-${attachmentCount}${mimeType==='application/pdf'?'.pdf':''}`);
      const sourcePath=[...parents,filename],nested=mimeType==='message/rfc822'||mimeType==='message/global'||/\.eml$/i.test(filename);
      const declaredPdf=mimeType==='application/pdf'||/\.pdf$/i.test(filename),isPdf=declaredPdf&&content.length>=5&&new TextDecoder('ascii').decode(content.subarray(0,5))==='%PDF-';
      attachmentSources.push({filename,sourcePath,mimeType,byteSize:content.byteLength,depth,kind:isPdf?'pdf':declaredPdf?'invalid_pdf':nested?'email':'other'});
      if(isPdf)pdfs.push({filename,mimeType:'application/pdf',content,sourcePath});
      else if(nested){
        if(depth>=MAX_DEPTH)throw new PaymentReceiptAttachmentLimitError('内嵌邮件超过 3 层自动提取上限',{limit:'depth',depth:depth+1,maxDepth:MAX_DEPTH});
        nestedEmailCount++;await visit(content,depth+1,sourcePath);
      }
    }
  }
  await visit(input,0,[]);
  return{pdfs,attachmentSources,attachmentCount,totalAttachmentBytes,nestedEmailCount};
}
