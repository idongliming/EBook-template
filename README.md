# EBook-template

在线电子书生成器

## 环境搭建

- `npm isntall` 安装项目依赖
- `npm run build` 生成静态文件
- 将 dist 文件夹下文件部署到任意服务器下即可

## 使用

- 根据提示修改static/index.html文件
- 在 chapters 文件夹下可创建文件夹，例如 “第一部” 其下为markdown文件，以数字命名比如 0.md 1.md
如需添加评论支持需要在github创建 issues 将 issues 地址 添加到 示例的位置

*如果要添加关键词统计，可以修改src/builder/keywords.ts*