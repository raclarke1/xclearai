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
2. Naturally qualify leads by learning about their business:
   - What industry/business they're in
   - Company size (employees)
   - What challenges they face (repetitive tasks, missed calls, slow processes)
   - Current tech setup
3. Guide toward booking a free AI audit
4. Be conversational, helpful, and professional — not pushy
5. Keep responses SHORT (2-3 sentences max unless they ask for detail)

QUALIFYING APPROACH:
- Don't rapid-fire questions — weave them into natural conversation
- If they mention a pain point, acknowledge it and explain how XClear helps
- After 3-4 exchanges, suggest scheduling a free AI audit
- If they want to talk to someone: "I can have Ryan reach out directly — what's the best email or phone to reach you?"

IMPORTANT: You ARE the XClear AI chatbot. This is a live demo of exactly what we build for clients. If someone asks "is this an AI?" — yes, and it's an example of what we deploy for businesses like theirs.

Never make up capabilities we don't have. Never discuss pricing specifics beyond the ranges above.`;

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const { messages, action, visitorInfo } = await context.request.json();

    if (action === 'end-chat') {
      return handleEndChat(messages, visitorInfo, context.env, corsHeaders);
    }

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(-20),
    ];

    const systemMsg = apiMessages.find(m => m.role === 'system')?.content || '';
    const chatMsgs = apiMessages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 300,
        system: systemMsg,
        messages: chatMsgs,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('Anthropic error:', JSON.stringify(data.error));
      return new Response(JSON.stringify({ error: 'AI temporarily unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ reply: data.content[0].text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Chat error:', err);
    return new Response(JSON.stringify({ error: 'Something went wrong' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

async function handleEndChat(messages, visitorInfo, env, corsHeaders) {
  if (!messages || messages.length < 3) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const summaryResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 500,
        system: `Analyze this chat and extract a lead summary. Return JSON:
- name, company, industry, size, email, phone (or "Unknown"/null)
- painPoints: array
- interest: services interested in
- leadScore: 1-10
- summary: 2-3 sentences
Return ONLY valid JSON.`,
        messages: [
          {
            role: 'user',
            content: messages.map(m => `${m.role === 'user' ? 'Visitor' : 'AI'}: ${m.content}`).join('\n')
          }
        ],
      }),
    });

    const summaryData = await summaryResponse.json();
    let lead = {};
    try {
      lead = JSON.parse(summaryData.content[0].text);
    } catch {
      lead = { summary: summaryData.content?.[0]?.text || 'Parse failed' };
    }

    // Format and send email via MailChannels (free on CF Workers/Pages)
    const transcript = messages.map(m =>
      `<p style="margin:4px 0;"><strong style="color:${m.role === 'user' ? '#2563eb' : '#059669'}">${m.role === 'user' ? 'Visitor' : 'XClear AI'}:</strong> ${m.content}</p>`
    ).join('');

    const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <div style="background:linear-gradient(135deg,#1e1b4b,#312e81);color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">New Chat Lead from xclearai.com</h2>
        <p style="margin:8px 0 0;opacity:0.8;">Lead Score: ${'★'.repeat(Math.min(lead.leadScore || 1, 10))} (${lead.leadScore || '?'}/10)</p>
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
        <p style="font-style:italic;color:#475569;">${lead.summary || ''}</p>
      </div>
      <div style="background:white;padding:20px;border:1px solid #e2e8f0;border-top:0;">
        <h3 style="margin:0 0 12px;">Full Transcript</h3>
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;font-size:13px;">${transcript}</div>
      </div>
    </div>`;

    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: 'ryan@xclearnetworks.com', name: 'Ryan Clarke' }] }],
        from: { email: 'chat@xclearai.com', name: 'XClear AI Chat' },
        subject: `Chat Lead: ${lead.name || 'Unknown'}${lead.company !== 'Unknown' ? ` (${lead.company})` : ''} — Score ${lead.leadScore || '?'}/10`,
        content: [{ type: 'text/html', value: emailHtml }],
      }),
    });

    return new Response(JSON.stringify({ ok: true, lead }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('End chat error:', err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
