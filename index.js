const ADMIN_PASSWORD = 'your-password'; // 管理员密码

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 管理员页面逻辑
	const { pathname } = new URL(request.url);
	if (pathname.startsWith("/cdn")) {
		var rqurl="https://raw.githubusercontent.com/Admirepowered"+pathname
		var a =fetch(rqurl);
		return a;
	}
	if (pathname.startsWith("/file")) {
       	var rqurl="https://telegra.ph"+pathname
		var a =fetch(rqurl);
		return a;
    }
	if (pathname.startsWith("/proxy")) {
       	var rqurl=pathname.substr(7)
		var a =fetch(rqurl);
		return a;
    }
	
    if (url.pathname.startsWith('/admin')) {
      const cookies = getCookies(request.headers.get('Cookie'));
      const storedAdminKey = cookies['admin_key'];

      if (request.method === 'GET') {
        if (storedAdminKey === ADMIN_PASSWORD) {
          // 已登录，显示发布文章页面
          return renderAdminPostPage(env);
        } else {
          return renderAdminPasswordPage(); // 提示输入密码
        }
      } else if (request.method === 'POST') {
        return await handleAdminRoutes(request, env, storedAdminKey); // 处理密码验证与文章发布
      }
    }

    // 处理评论提交
    if (url.pathname.startsWith('/comments') && request.method === 'POST') {
      const articleId = url.searchParams.get('articleId'); // 从请求参数获取文章 ID
      return handleCommentSubmission(request, articleId, env);
    }

    // 删除评论
    if (url.pathname.startsWith('/delete-comment') && request.method === 'POST') {
      return await handleDeleteComment(request, env);
    }

    // 获取文章列表 (主页)
    if (url.pathname === '/' && request.method === 'GET') {
      await initializeIndex(env); // 初始化 INDEX
      const page = parseInt(url.searchParams.get('page')) || 1; // 获取页码，默认为 1
      const articles = await getArticles(page, env);
      return new Response(renderHomePage(articles, page), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    // 文章详情页，例如 /1.html, /2.html
    if (url.pathname.endsWith('.html')) {
      const articleId = url.pathname.split('/').pop().replace('.html', '');
      const article = await getArticleById(articleId, env);
      const comments = await getArticleComments(articleId, env); // 获取文章的评论
      const admin = isAdmin(request);
      if (article && !article.deleted) { // 检查文章是否已标记为删除
        return new Response(renderArticlePage(article.title, article.content, comments, articleId, admin), {
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        });
      } else {
        return new Response('文章未找到', { status: 404, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
      }
    }

    // 其他请求返回 404
    return new Response('未找到页面', { status: 404, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  },
};

async function handleDeleteComment(request, env) {
  const url = new URL(request.url);
  const articleId = url.searchParams.get('articleId');
  const commentId = url.searchParams.get('commentId');
  
  if (await isAdmin(request)) {
    await env.BLOG.delete(`comments_${articleId}_${commentId}`); // 删除评论
    return Response.redirect(`/${articleId}.html`, 302); // 重定向到文章页面
  } else {
    return new Response("Unauthorized", { status: 403 });
  }
}

// 初始化 INDEX
async function initializeIndex(env) {
  const index = await env.BLOG.get('INDEX');
  if (!index) {
    await env.BLOG.put('INDEX', '0'); // 初始化为 0
  }
}

async function handleEditArticle(request, env,formData) {
  //const formData = await request.formData();
  const articleId = formData.get('articleId');
  const newTitle = formData.get('title');
  const newContent = formData.get('content');
  const article = await env.BLOG.get(`article_${articleId - 1}`);
  
  if (article) {
    const updatedArticle = JSON.parse(article);
    updatedArticle.title = newTitle;
    updatedArticle.content = newContent;
    await env.BLOG.put(`article_${articleId - 1}`, JSON.stringify(updatedArticle)); // 更新文章
  }

  return new Response('文章已修改', { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}
// 处理管理员路由，添加发布文章和删除文章逻辑
async function handleAdminRoutes(request, env, storedAdminKey) {
  const formData = await request.formData();
  const password = formData.get('password');

  // 验证密码
  if (!storedAdminKey && password !== ADMIN_PASSWORD) {
    return new Response('密码错误', { status: 403, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }

  if (!storedAdminKey) {
    // 密码正确，设置 Cookie
    return new Response(renderAdminPostPage(env), {
      headers: {
        'Set-Cookie': `admin_key=${ADMIN_PASSWORD}; Path=/; HttpOnly; SameSite=Strict`,
        'Content-Type': 'text/html; charset=UTF-8',
      },
    });
  }

  // 处理删除文章
  if (formData.has('delete')) {
    const articleId = formData.get('articleId');
    return await deleteArticle(articleId, env);
  }
  if (formData.has('edit')) {
    const articleId = formData.get('articleId');
    const article = await getArticleById(articleId, env);
  return new Response(`
      <html>
        <head><meta charset="UTF-8"><title>编辑文章</title></head>
        <body>
          <h1>编辑文章</h1>
          <form action="/admin" method="POST">
            <input type="hidden" name="articleId" value="${articleId}">
            <input type="text" name="title" value="${article.title}" required><br>
            <textarea name="content" required>${article.content}</textarea><br>
            <button type="submit" name="save">保存修改</button>
          </form>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
  if (formData.has('save')) {
    return await handleEditArticle(request, env,formData);
  }

  // 发布文章
  const title = formData.get('title');
  const content = formData.get('content');
  const index = parseInt(await env.BLOG.get('INDEX')) || 0;

  // 存储文章
  const articleId = index + 1;
  const article = { id: articleId, title, content, deleted: false }; // 新增 deleted 字段
  await env.BLOG.put(`article_${index}`, JSON.stringify(article)); // 使用索引存储文章
  await env.BLOG.put('INDEX', articleId.toString()); // 更新 INDEX

  // 返回成功信息
  return new Response(`
    <html>
      <head><meta charset="UTF-8"><title>文章发布成功</title></head>
      <body>
        <h1>文章发布成功!</h1>
        <p><a href="/">返回首页</a></p>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// 删除文章
async function deleteArticle(articleId, env) {
  const article = await env.BLOG.get(`article_${articleId - 1}`); // 获取文章
  if (article) {
    const updatedArticle = JSON.parse(article);
    updatedArticle.deleted = true; // 标记为删除
    await env.BLOG.put(`article_${articleId - 1}`, JSON.stringify(updatedArticle)); // 更新文章
  }
  return new Response('文章已标记为删除', { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// 渲染管理员密码输入页面
function renderAdminPasswordPage() {
  return new Response(`
    <html>
      <head><meta charset="UTF-8"><title>管理员登录</title></head>
      <body>
        <h1>请输入管理员密钥</h1>
        <form action="/admin" method="POST">
          <input type="password" name="password" placeholder="请输入密钥" required>
          <button type="submit">提交</button>
        </form>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// 渲染文章发布和管理页面
async function renderAdminPostPage(env) {
  const articles = await getAllArticles(env);
  const articlesList = articles.map(article => `
    <li>
      ${article.title} 
      <form action="/admin" method="POST" style="display:inline;">
        <input type="hidden" name="articleId" value="${article.id}">
        <button type="submit" name="delete">删除</button>
		<button type="submit" name="edit">编辑</button> 
      </form>
    </li>
  `).join('');

  return new Response(`
    <html>
      <head><meta charset="UTF-8"><title>发布文章</title></head>
      <body>
        <h1>发布新文章</h1>
        <form id="article-form" method="POST">
          <input type="text" name="title" placeholder="文章标题" required><br>
          <textarea name="content" placeholder="文章内容" required></textarea><br>
          <button type="submit">发布文章</button>
        </form>
        <h2>现有文章</h2>
        <ul>${articlesList}</ul>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// 从请求中获取 Cookies
function getCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(cookie => {
    const [name, ...value] = cookie.trim().split('=');
    cookies[name] = decodeURIComponent(value.join('='));
  });
  return cookies;
}

// 获取所有文章
async function getAllArticles(env) {
  const index = parseInt(await env.BLOG.get('INDEX')) || 0; // 获取索引
  const articles = [];
  
  for (let i = 0; i < index; i++) {
    const article = await env.BLOG.get(`article_${i}`);
    if (article) {
      articles.push(JSON.parse(article));
    }
  }
  return articles;
}

// 获取文章列表
async function getArticles(page, env) {
  const articlesPerPage = 10; // 每页文章数量
  const index = parseInt(await env.BLOG.get('INDEX')) || 0; // 获取索引
  const articles = [];
  
  for (let i = (page - 1) * articlesPerPage; i < Math.min(index, page * articlesPerPage); i++) {
    const article = await env.BLOG.get(`article_${i}`);
    if (article) {
      const parsedArticle = JSON.parse(article);
      if (!parsedArticle.deleted) { // 只获取未删除的文章
        articles.push(parsedArticle);
      }
    }
  }
  return articles;
}

// 根据 ID 获取文章
async function getArticleById(id, env) {
  const article = await env.BLOG.get(`article_${id - 1}`); // 索引从 0 开始
  return article ? JSON.parse(article) : null;
}

// 获取文章评论
async function getArticleComments(articleId, env) {
  const comments = [];
  const keys = await env.BLOG.list({ prefix: `comments_${articleId}` }); // 获取文章评论
  for (const key of keys.keys) {
    const comment = await env.BLOG.get(key.name);
    if (comment) {
      comments.push(JSON.parse(comment));
    }
  }
  return comments;
}

// 处理评论提交
async function handleCommentSubmission(request, articleId, env) {
  const formData = await request.formData();
  const content = formData.get('content');

  const commentId = Date.now(); // 使用时间戳作为评论 ID
  const comment = { id: commentId, content };

  await env.BLOG.put(`comments_${articleId}_${commentId}`, JSON.stringify(comment)); // 存储评论

  return new Response(`
    <html>
      <head><meta charset="UTF-8"><title>评论提交成功</title></head>
      <body>
        <h1>评论提交成功!</h1>
        <p><a href="/${articleId}.html">返回文章</a></p>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// 渲染文章页面

function renderArticlePage(title, content, comments, articleId, isAdmin) {
  const commentsHtml = comments.length > 0 
    ? comments.map(comment => `
        <div id="comment">${comment.content}${isAdmin ? `<form action="/delete-comment?articleId=${articleId}&commentId=${comment.id}" method="POST">
                        <button type="submit">删除评论</button>
                      </form>` : ''}
        </div>
      `).join('') 
    : '<p>还没有评论。</p>';

  return `
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <script src="https://cdn.staticfile.net/marked/11.1.1/marked.min.js"></script>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            const contentEl = document.getElementById('markdown-content');
            contentEl.innerHTML = marked.parse(contentEl.innerHTML);

            // 渲染评论
            const commentsEl = document.getElementById('comments');
            const commentElements = commentsEl.children;
            for (let i = 0; i < commentElements.length; i++) {
              commentElements[i].innerHTML = marked.parse(commentElements[i].innerHTML);
            }
          });
        </script>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .comment { border-top: 1px solid #ccc; padding: 10px 0; }
          .comment p { margin: 0; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div id="markdown-content">${content}</div>
        
        <h2>评论区</h2>
        <form action="/comments?articleId=${articleId}" method="POST">
          <textarea name="content" placeholder="发表评论" required></textarea><br>
          <button type="submit">提交评论</button>
        </form>
        
        <div id="comments">
          ${commentsHtml}
        </div>
      </body>
    </html>
  `;
}


function isAdmin(request) {
  const cookieHeader = request.headers.get('Cookie');
  return cookieHeader && cookieHeader.includes('admin_key='+ADMIN_PASSWORD);
}

// 渲染主页
function renderHomePage(articles, page) {
  const articlesHtml = articles.map(article => `
    <li>
      <a href="/${article.id}.html">${article.title}</a>
    </li>
  `).join('');
  return `
    <html>
      <head><meta charset="UTF-8"><title>主页</title></head>
      <body>
        <h1>欢迎来到我的博客</h1>
        <h2>文章列表</h2>
        <ul>${articlesHtml}</ul>
        <p>${page > 1 ? `<a href="/?page=${page - 1}">上一页</a>` : ''} <a href="/?page=${page + 1}">下一页</a></p>
      </body>
    </html>
  `;
}
