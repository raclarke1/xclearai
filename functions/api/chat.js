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

    // Option 1: Anthropic API (if key is set)
    const anthropicKey = context.env.ANTHROPIC_API_KEY;
    if (anthropicKey && !reply) {
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
        } else {
          console.error('Anthropic:', res.status, await res.text());
        }
      } catch (e) {
        console.error('Anthropic error:', e.message);
      }
    }

    // Option 2: Workers AI (free, built into Cloudflare)
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
      return new Response(JSON.stringify({ 
        error: 'AI temporarily unavailable',
        debug: `anthropic_key=${!!anthropicKey}, workers_ai=${!!context.env.AI}`
      }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ reply }), { headers: corsHeaders });
  } catch (err) {
    console.error('Chat error:', err);
    return new Response(JSON.stringify({ error: 'Something went wrong', debug: err.message }), {
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
    // Summarize with whatever AI is available
    let lead = { summary: 'Chat ended', leadScore: 5 };
    
    const summaryPrompt = {
      role: 'user',
      content: `Analyze this chat and return JSON with: name, company, industry, email, phone (or "Unknown"/null), painPoints (array), interest, leadScore (1-10), summary (2-3 sentences). ONLY valid JSON.\n\n${messages.map(m => `${m.role === 'user' ? 'Visitor' : 'AI'}: ${m.content}`).join('\n')}`
    };

    const anthropicKey = context.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [summaryPrompt],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          try { lead = JSON.parse(data.content[0].text); } catch {}
        }
      } catch {}
    } else if (context.env.AI) {
      try {
        const result = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'system', content: 'Return only valid JSON.' }, summaryPrompt],
          max_tokens: 500,
        });
        try { lead = JSON.parse(result.response); } catch {}
      } catch {}
    }

    // Email via MailChannels (free on Cloudflare)
    const transcript = messages.map(m =>
      `<p><strong>${m.role === 'user' ? 'Visitor' : 'XClear AI'}:</strong> ${m.content}</p>`
    ).join('');

    const emailHtml = `<div style="font-family:Arial;max-width:600px;">
      <div style="background:#1e1b4b;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">New Chat Lead — Score ${lead.leadScore || '?'}/10</h2>
      </div>
      <div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;">
        <p><b>Name:</b> ${lead.name || 'Unknown'} | <b>Company:</b> ${lead.company || 'Unknown'}</p>
        <p><b>Industry:</b> ${lead.industry || 'Unknown'} | <b>Interest:</b> ${lead.interest || 'General'}</p>
        <p><b>Email:</b> ${lead.email || 'N/A'} | <b>Phone:</b> ${lead.phone || 'N/A'}</p>
        <p><i>${lead.summary || ''}</i></p>
      </div>
      <div style="background:white;padding:20px;border:1px solid #e2e8f0;border-top:0;">
        <h3>Transcript</h3>
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;font-size:13px;">${transcript}</div>
      </div>
    </div>`;

    try {
      await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: 'ryan@xclearnetworks.com' }] }],
          from: { email: 'chat@xclearai.com', name: 'XClear AI Chat' },
          subject: `Chat Lead: ${lead.name || 'Unknown'} — Score ${lead.leadScore || '?'}/10`,
          content: [{ type: 'text/html', value: emailHtml }],
        }),
      });
    } catch (e) {
      console.error('Email error:', e.message);
    }

    return new Response(JSON.stringify({ ok: true, lead }), { headers: corsHeaders });
  } catch (err) {
    console.error('End chat error:', err);
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
}
