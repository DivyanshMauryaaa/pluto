// components/MarkdownRenderer.tsx
'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    return (
        <div className={`prose prose-slate max-w-none ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeRaw]}
                components={{
                    // Code blocks with syntax highlighting
                    code({ node, className, children, ...props }) {
                        // @ts-expect-error 'inline' is in react-markdown types but not in standard HTML props
                        const inline = props.inline;
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';

                        return !inline && language ? (
                            <SyntaxHighlighter
                                style={vscDarkPlus as any}
                                language={language}
                                PreTag="div"
                                className="!my-6 !rounded-md text-sm"
                            >
                                {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                        ) : (
                            <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-sm font-mono text-pink-600 dark:text-pink-400 before:content-none after:content-none" {...props}>
                                {children}
                            </code>
                        );
                    },

                    // Headings with anchor links
                    h1({ children, ...props }) {
                        const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
                        return (
                            <h1 id={id} className="text-4xl font-semibold mt-6 mb-4 pb-3 border-b border-slate-200 dark:border-slate-700" {...props}>
                                {children}
                            </h1>
                        );
                    },
                    h2({ children, ...props }) {
                        const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
                        return (
                            <h2 id={id} className="text-3xl font-semibold mt-6 mb-4 pb-3 border-b border-slate-200 dark:border-slate-700" {...props}>
                                {children}
                            </h2>
                        );
                    },
                    h3({ children, ...props }) {
                        const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
                        return (
                            <h3 id={id} className="text-2xl font-semibold mt-6 mb-4" {...props}>
                                {children}
                            </h3>
                        );
                    },
                    h4({ children, ...props }) {
                        const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
                        return (
                            <h4 id={id} className="text-xl font-semibold mt-6 mb-4" {...props}>
                                {children}
                            </h4>
                        );
                    },
                    h5({ children, ...props }) {
                        const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
                        return (
                            <h5 id={id} className="text-lg font-semibold mt-6 mb-4" {...props}>
                                {children}
                            </h5>
                        );
                    },
                    h6({ children, ...props }) {
                        const id = String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
                        return (
                            <h6 id={id} className="text-base font-semibold mt-6 mb-4" {...props}>
                                {children}
                            </h6>
                        );
                    },

                    // Paragraphs
                    p({ children, ...props }) {
                        return (
                            <p className="mb-4 leading-7" {...props}>
                                {children}
                            </p>
                        );
                    },

                    // Lists
                    ul({ children, ...props }) {
                        return (
                            <ul className="list-disc pl-8 mb-4 space-y-1" {...props}>
                                {children}
                            </ul>
                        );
                    },
                    ol({ children, ...props }) {
                        return (
                            <ol className="list-decimal pl-8 mb-4 space-y-1" {...props}>
                                {children}
                            </ol>
                        );
                    },
                    li({ children, ...props }) {
                        return (
                            <li className="leading-7" {...props}>
                                {children}
                            </li>
                        );
                    },

                    // Tables
                    table({ children, ...props }) {
                        return (
                            <div className="overflow-x-auto my-6">
                                <table className="min-w-full border-collapse border border-slate-300 dark:border-slate-600" {...props}>
                                    {children}
                                </table>
                            </div>
                        );
                    },
                    thead({ children, ...props }) {
                        return (
                            <thead className="bg-slate-100 dark:bg-slate-800" {...props}>
                                {children}
                            </thead>
                        );
                    },
                    tbody({ children, ...props }) {
                        return (
                            <tbody {...props}>
                                {children}
                            </tbody>
                        );
                    },
                    tr({ children, ...props }) {
                        return (
                            <tr className="border-t border-slate-300 dark:border-slate-600 even:bg-slate-50 dark:even:bg-slate-800/50" {...props}>
                                {children}
                            </tr>
                        );
                    },
                    th({ children, ...props }) {
                        return (
                            <th className="px-4 py-2 text-left font-semibold border border-slate-300 dark:border-slate-600" {...props}>
                                {children}
                            </th>
                        );
                    },
                    td({ children, ...props }) {
                        return (
                            <td className="px-4 py-2 border border-slate-300 dark:border-slate-600" {...props}>
                                {children}
                            </td>
                        );
                    },

                    // Links
                    a({ href, children, ...props }) {
                        const isExternal = href?.startsWith('http');
                        return (
                            <a
                                href={href}
                                target={isExternal ? '_blank' : undefined}
                                rel={isExternal ? 'noopener noreferrer' : undefined}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                                {...props}
                            >
                                {children}
                            </a>
                        );
                    },

                    // Blockquotes
                    blockquote({ children, ...props }) {
                        return (
                            <blockquote className="border-l-4 border-slate-300 dark:border-slate-600 pl-4 my-4 italic text-slate-600 dark:text-slate-400" {...props}>
                                {children}
                            </blockquote>
                        );
                    },

                    // Images
                    img({ src, alt, ...props }) {
                        return (
                            <img
                                src={src}
                                alt={alt}
                                loading="lazy"
                                className="max-w-full h-auto rounded-lg my-4"
                                {...props}
                            />
                        );
                    },

                    // Horizontal rule
                    hr({ ...props }) {
                        return (
                            <hr className="my-6 border-t-4 border-slate-200 dark:border-slate-700" {...props} />
                        );
                    },

                    // Task lists (checkboxes)
                    input({ type, checked, ...props }) {
                        if (type === 'checkbox') {
                            return (
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled
                                    className="mr-2 cursor-default"
                                    {...props}
                                />
                            );
                        }
                        return <input type={type} {...props} />;
                    },

                    // Strong/Bold
                    strong({ children, ...props }) {
                        return (
                            <strong className="font-semibold" {...props}>
                                {children}
                            </strong>
                        );
                    },

                    // Emphasis/Italic
                    em({ children, ...props }) {
                        return (
                            <em className="italic" {...props}>
                                {children}
                            </em>
                        );
                    },

                    // Strikethrough
                    del({ children, ...props }) {
                        return (
                            <del className="line-through" {...props}>
                                {children}
                            </del>
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}