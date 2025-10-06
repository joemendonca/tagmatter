import { App, Plugin, PluginSettingTab, Setting, TFile, Notice } from 'obsidian';

interface TagmatterSettings {
	autoSync: boolean;
	removeInlineTags: boolean;
	lowercaseTags: boolean;
}

const DEFAULT_SETTINGS: TagmatterSettings = {
	autoSync: true,
	removeInlineTags: false,
	lowercaseTags: true
}

export default class TagmatterPlugin extends Plugin {
	settings: TagmatterSettings;
	private processing: Set<string> = new Set();
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

	async onload() {
		await this.loadSettings();

		// Add command to manually sync tags
		this.addCommand({
			id: 'sync-tags-to-frontmatter',
			name: 'Sync tags to frontmatter',
			editorCallback: async (editor, view) => {
				if (view.file) {
					await this.syncTagsToFrontmatter(view.file);
					new Notice('Tags synced to frontmatter');
				}
			}
		});

		// Auto-sync on file save if enabled
		if (this.settings.autoSync) {
			this.registerEvent(
				this.app.vault.on('modify', async (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						// Debounce: wait 2 seconds after user stops typing
						const existingTimer = this.debounceTimers.get(file.path);
						if (existingTimer) {
							clearTimeout(existingTimer);
						}
						
						const timer = setTimeout(async () => {
							await this.syncTagsToFrontmatter(file);
							this.debounceTimers.delete(file.path);
						}, 2000); // Wait 2 seconds after typing stops
						
						this.debounceTimers.set(file.path, timer);
					}
				})
			);
		}

		// Add settings tab
		this.addSettingTab(new TagmatterSettingTab(this.app, this));
	}

	async syncTagsToFrontmatter(file: TFile) {
		// Prevent re-entrant calls for the same file
		if (this.processing.has(file.path)) {
			return;
		}
		
		this.processing.add(file.path);
		
		try {
			const content = await this.app.vault.read(file);
			
			// Extract inline tags from content
			const inlineTags = this.extractInlineTags(content);

			// Parse frontmatter manually to check existing tags
			const { frontmatterText, bodyText, hasFrontmatter } = this.parseFrontmatter(content);
			const existingTags = this.getExistingTags(frontmatterText);
			
			// Sort inline tags for comparison
			const sortedInlineTags = [...inlineTags].sort();
			const sortedExisting = [...existingTags].sort();
			
			// Only update if tags have changed
			if (this.arraysEqual(sortedExisting, sortedInlineTags)) {
				return; // No changes needed
			}
			
			// If no inline tags, remove frontmatter tags section (or entire frontmatter if empty)
			if (inlineTags.length === 0) {
				if (hasFrontmatter) {
					const newFrontmatterText = this.removeTags(frontmatterText);
					// Only keep frontmatter if there's other content
					if (newFrontmatterText.trim()) {
						const newContent = `---\n${newFrontmatterText}---\n${bodyText}`;
						await this.app.vault.modify(file, newContent);
					} else {
						// Remove frontmatter entirely if tags were the only thing
						await this.app.vault.modify(file, bodyText);
					}
				}
				return;
			}
			
			// Build new frontmatter with updated tags (only inline tags, no merging)
			const newFrontmatterText = this.buildFrontmatterWithTags(frontmatterText, sortedInlineTags, hasFrontmatter);
			
			// Reconstruct file with new frontmatter
			const newContent = hasFrontmatter 
				? `---\n${newFrontmatterText}---\n${bodyText}`
				: `---\n${newFrontmatterText}---\n${content}`;
			
			// Write directly to vault - this triggers proper metadata cache update
			await this.app.vault.modify(file, newContent);
			
		} finally {
			// Remove from processing after a short delay
			setTimeout(() => {
				this.processing.delete(file.path);
			}, 500);
		}
	}
	
	parseFrontmatter(content: string): { frontmatterText: string, bodyText: string, hasFrontmatter: boolean } {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
		const match = content.match(frontmatterRegex);
		
		if (match) {
			return {
				frontmatterText: match[1],
				bodyText: match[2],
				hasFrontmatter: true
			};
		}
		
		return {
			frontmatterText: '',
			bodyText: content,
			hasFrontmatter: false
		};
	}
	
	getExistingTags(frontmatterText: string): string[] {
		if (!frontmatterText) return [];
		
		const lines = frontmatterText.split('\n');
		const tags: string[] = [];
		let inTagsSection = false;
		
		for (const line of lines) {
			const trimmed = line.trim();
			
			if (trimmed === 'tags:' || trimmed.startsWith('tags:')) {
				inTagsSection = true;
				// Check for inline array format: tags: [tag1, tag2]
				const inlineMatch = trimmed.match(/tags:\s*\[(.*)\]/);
				if (inlineMatch) {
					const inlineTags = inlineMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
					return inlineTags.filter(t => t.length > 0);
				}
				continue;
			}
			
			if (inTagsSection) {
				if (trimmed.startsWith('-')) {
					const tag = trimmed.substring(1).trim();
					if (tag) tags.push(tag);
				} else if (trimmed && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
					// We've left the tags section
					break;
				}
			}
		}
		
		return tags;
	}
	
	removeTags(frontmatterText: string): string {
		const lines = frontmatterText.split('\n');
		const newLines: string[] = [];
		let inTagsSection = false;
		
		for (const line of lines) {
			const trimmed = line.trim();
			
			// Check if entering tags section
			if (trimmed === 'tags:' || trimmed.startsWith('tags:')) {
				inTagsSection = true;
				continue; // Skip the tags: line
			}
			
			// Skip tag lines
			if (inTagsSection && trimmed.startsWith('-')) {
				continue;
			}
			
			// Check if leaving tags section
			if (inTagsSection && trimmed && !trimmed.startsWith('-') && !trimmed.startsWith(' ')) {
				inTagsSection = false;
			}
			
			// Add non-tag lines
			if (!inTagsSection) {
				newLines.push(line);
			}
		}
		
		return newLines.join('\n');
	}
	
	buildFrontmatterWithTags(frontmatterText: string, tags: string[], hadFrontmatter: boolean): string {
		if (!hadFrontmatter || !frontmatterText) {
			// Create new frontmatter with just tags
			const tagLines = tags.map(tag => `  - ${tag}`).join('\n');
			return `tags:\n${tagLines}\n`;
		}
		
		// Remove existing tags section
		const lines = frontmatterText.split('\n');
		const newLines: string[] = [];
		let inTagsSection = false;
		let tagsInserted = false;
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			
			// Check if entering tags section
			if (trimmed === 'tags:' || trimmed.startsWith('tags:')) {
				inTagsSection = true;
				// Insert updated tags
				newLines.push('tags:');
				tags.forEach(tag => newLines.push(`  - ${tag}`));
				tagsInserted = true;
				continue;
			}
			
			// Skip old tag lines
			if (inTagsSection && trimmed.startsWith('-')) {
				continue;
			}
			
			// Check if leaving tags section
			if (inTagsSection && trimmed && !trimmed.startsWith('-') && !trimmed.startsWith(' ')) {
				inTagsSection = false;
			}
			
			// Add non-tag lines
			if (!inTagsSection) {
				newLines.push(line);
			}
		}
		
		// If tags weren't in the frontmatter, add them at the beginning
		if (!tagsInserted) {
			const tagLines = ['tags:', ...tags.map(tag => `  - ${tag}`)];
			return [...tagLines, ...newLines].join('\n') + '\n';
		}
		
		return newLines.join('\n') + '\n';
	}

	extractInlineTags(content: string): string[] {
		// Match hashtags: word boundaries, alphanumeric, hyphens, underscores
		// This regex captures tags and removes trailing punctuation
		const tagRegex = /#([\w\-]+)/g;
		const tags: string[] = [];
		let match;

		while ((match = tagRegex.exec(content)) !== null) {
			let tag = match[1]; // The captured group without the #
			if (tag && tag.length > 0) {
				// Optionally convert to lowercase based on settings
				if (this.settings.lowercaseTags) {
					tag = tag.toLowerCase();
				}
				tags.push(tag);
			}
		}

		// Dedupe and return
		return Array.from(new Set(tags));
	}

	arraysEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TagmatterSettingTab extends PluginSettingTab {
	plugin: TagmatterPlugin;

	constructor(app: App, plugin: TagmatterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Auto-sync tags')
			.setDesc('Automatically sync inline tags to frontmatter on file save')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSync)
				.onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
					new Notice('Please reload Obsidian for this change to take effect');
				}));

		new Setting(containerEl)
			.setName('Lowercase tags')
			.setDesc('Convert all tags to lowercase (e.g., #Portland becomes portland)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.lowercaseTags)
				.onChange(async (value) => {
					this.plugin.settings.lowercaseTags = value;
					await this.plugin.saveSettings();
				}));
	}
}

