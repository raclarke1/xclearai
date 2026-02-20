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

    // Build transcript
    const transcript = messages.map(m =>
      `${m.role === 'user' ? ':bust_in_silhouette: *Visitor*' : ':robot_face: *XClear AI*'}: ${m.content}`
    ).join('\n');

    const stars = '★'.repeat(Math.min(lead.leadScore || 0, 10)) + '☆'.repeat(10 - Math.min(lead.leadScore || 0, 10));

    // Post to Slack via webhook
    const webhookUrl = context.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      const slackPayload = {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `🔔 New Chat Lead — Score ${lead.leadScore || '?'}/10`, emoji: true }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Name:*\n${lead.name || 'Unknown'}` },
              { type: 'mrkdwn', text: `*Company:*\n${lead.company || 'Unknown'}` },
              { type: 'mrkdwn', text: `*Industry:*\n${lead.industry || 'Unknown'}` },
              { type: 'mrkdwn', text: `*Score:*\n${stars}` },
              { type: 'mrkdwn', text: `*Email:*\n${lead.email || 'Not provided'}` },
              { type: 'mrkdwn', text: `*Phone:*\n${lead.phone || 'Not provided'}` },
            ]
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Interest:* ${lead.interest || 'General'}` }
          },
          lead.painPoints?.length ? {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Pain Points:*\n${lead.painPoints.map(p => `• ${p}`).join('\n')}` }
          } : null,
          lead.summary && lead.summary !== 'Chat ended' ? {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Summary:* _${lead.summary}_` }
          } : null,
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Full Transcript (${messages.length} messages):*\n${transcript}` }
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `📍 ${visitorInfo?.page || 'xclearai.com'} | ${visitorInfo?.referrer ? `Ref: ${visitorInfo.referrer}` : 'Direct'} | ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })} MST` }
            ]
          }
        ].filter(Boolean)
      };

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackPayload),
        });
      } catch (e) {
        console.error('Slack webhook error:', e.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, lead }), { headers: corsHeaders });
  } catch (err) {
    console.error('End chat error:', err);
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
}
