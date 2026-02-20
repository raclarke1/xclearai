const SYSTEM_PROMPT = `You are the AI assistant on xclearai.com — the website for XClear AI, a Utah-based company that helps small and medium businesses automate operations with AI and managed IT services.

ABOUT XCLEAR AI:
- Founded by Ryan Clarke
- Services: AI-powered chatbots, workflow automation, email/document processing, IT infrastructure, network security, cloud management
- Target: Small/medium businesses (10-200 employees) in Utah — law firms, accounting, construction, trades, healthcare, professional services
- Pricing: Free AI Audit → $2-5K Pilot Project → $3-10K/mo Managed Services
- Contact: ryan@xclearnetworks.com | (385) 336-6005
- Website: xclearai.com

YOUR ROLE:
1. Answer questions about XClear AI's services clearly and concisely
2. Naturally qualify leads by learning about their business
3. Guide toward booking a free AI audit
4. Be conversational, helpful, and professional — not pushy
5. Keep responses SHORT (2-3 sentences max unless they ask for detail)

QUALIFYING APPROACH:
- Don't rapid-fire questions — weave them into natural conversation
- If they mention a pain point, acknowledge it and explain how XClear helps
- After 3-4 exchanges, suggest scheduling a free AI audit
- If they want to talk to someone: "I can have Ryan reach out directly — what's the best email or phone to reach you?"

You ARE the XClear AI chatbot — a live demo of what we build for clients.
Never make up capabilities. Never discuss pricing beyond the ranges above.`;

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { messages, action, visitorInfo } = await context.request.json();

    if (action === 'end-chat') {
      return handleEndChat(messages, visitorInfo, context, corsHeaders);
    }

    const allMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(messages || []).slice(-20),
    ];

    let reply = null;

    // Option 1: Anthropic API
    const anthropicKey = context.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      try {
        const systemMsg = allMessages.find(m => m.role === 'system')?.content || '';
        const chatMsgs = allMessages.filter(m => m.role !== 'system');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            system: systemMsg,
            messages: chatMsgs,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          reply = data.content?.[0]?.text || null;
        }
      } catch (e) {
        console.error('Anthropic error:', e.message);
      }
    }

    // Option 2: Workers AI (free fallback)
    if (!reply && context.env.AI) {
      try {
        const result = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: allMessages,
          max_tokens: 300,
        });
        reply = result.response;
      } catch (e) {
        console.error('Workers AI error:', e.message);
      }
    }

    if (!reply) {
      return new Response(JSON.stringify({ error: 'AI temporarily unavailable' }), {
        status: 500, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ reply }), { headers: corsHeaders });
  } catch (err) {
    console.error('Chat error:', err);
    return new Response(JSON.stringify({ error: 'Something went wrong' }), {
      status: 500, headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function handleEndChat(messages, visitorInfo, context, corsHeaders) {
  if (!messages || messages.length < 3) {
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  try {
    // Summarize the lead
    let lead = { summary: 'Chat ended', leadScore: 5 };
    const summaryPrompt = {
      role: 'user',
      content: `Analyze this chat and return JSON with: name, company, industry, email, phone (or "Unknown"/null), painPoints (array), interest, leadScore (1-10), summary (2-3 sentences). ONLY valid JSON.\n\n${messages.map(m => `${m.role === 'user' ? 'Visitor' : 'AI'}: ${m.content}`).join('\n')}`
    };

    if (context.env.AI) {
      try {
        const result = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'system', content: 'Return only valid JSON.' }, summaryPrompt],
          max_tokens: 500,
        });
        try { lead = JSON.parse(result.response); } catch {}
      } catch {}
    }

    // Build email
    const transcript = messages.map(m =>
      `<p style="margin:4px 0;"><strong style="color:${m.role === 'user' ? '#2563eb' : '#059669'}">${m.role === 'user' ? 'Visitor' : 'XClear AI'}:</strong> ${m.content}</p>`
    ).join('');

    const stars = '★'.repeat(Math.min(lead.leadScore || 0, 10)) + '☆'.repeat(10 - Math.min(lead.leadScore || 0, 10));

    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#1e1b4b,#312e81);color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">New Chat Lead from xclearai.com</h2>
        <p style="margin:8px 0 0;opacity:0.8;">Lead Score: ${stars} (${lead.leadScore || '?'}/10)</p>
      </div>
      <div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;">
        <table style="width:100%;font-size:14px;">
          <tr><td style="padding:4px 8px;font-weight:bold;width:100px;">Name:</td><td>${lead.name || 'Unknown'}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;">Company:</td><td>${lead.company || 'Unknown'}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;">Industry:</td><td>${lead.industry || 'Unknown'}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;">Email:</td><td>${lead.email || 'Not provided'}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;">Phone:</td><td>${lead.phone || 'Not provided'}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;">Interest:</td><td>${lead.interest || 'General'}</td></tr>
        </table>
        ${lead.painPoints?.length ? `<p style="margin:12px 0 4px;font-weight:bold;">Pain Points:</p><ul>${lead.painPoints.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
        ${lead.summary && lead.summary !== 'Chat ended' ? `<p style="font-style:italic;color:#475569;margin-top:12px;">${lead.summary}</p>` : ''}
      </div>
      <div style="background:white;padding:20px;border:1px solid #e2e8f0;border-top:0;">
        <h3 style="margin:0 0 12px;">Full Transcript (${messages.length} messages)</h3>
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;font-size:13px;">${transcript}</div>
      </div>
      <div style="padding:12px;text-align:center;font-size:12px;color:#94a3b8;">
        ${visitorInfo?.page || 'xclearai.com'} | ${visitorInfo?.referrer ? `Ref: ${visitorInfo.referrer}` : 'Direct'} | ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })} MST
      </div>
    </div>`;

    const subject = `Chat Lead: ${lead.name || 'Unknown'}${lead.company && lead.company !== 'Unknown' ? ` (${lead.company})` : ''} — Score ${lead.leadScore || '?'}/10`;

    // Send via Resend (free 100/day)
    const resendKey = context.env.RESEND_API_KEY;
    let emailStatus = 'no_key';
    if (resendKey) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'XClear AI Chat <onboarding@resend.dev>',
            to: ['ryan@xclearnetworks.com'],
            subject,
            html: emailHtml,
          }),
        });
        const emailResult = await emailRes.json();
        emailStatus = emailRes.ok ? 'sent' : JSON.stringify(emailResult);
        console.log('Resend result:', emailStatus);
      } catch (e) {
        emailStatus = e.message;
        console.error('Resend error:', e.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, lead, emailStatus }), { headers: corsHeaders });
  } catch (err) {
    console.error('End chat error:', err);
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
}
