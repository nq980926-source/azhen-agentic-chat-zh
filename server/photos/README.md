# 阿斟私有照片服务正式候选包

本目录复用原 S2-03 照片服务、官方腾讯云 SDK 和 SQLite 状态；不是新知识库。

唯一部署入口：`python -m photo_auth.production --config /etc/azhen-photo-auth/config.json`。
`python -m photo_auth` 也只进入同一正式入口，不提供 Mock COS 回退。

生产改动必须先批准 `PRODUCTION_CHANGE_REQUEST.md`，再由固定 Release 服务包的 `deploy/manage.py apply` 自动处理。它不是让用户手工修改源码的说明。

正式新对象只进入 `private-photos/v1/`；已确认的唯一旧隔离前缀只保留读取兼容。`deploymentMode=production` 启用 10 MiB / 4 / 40 MiB 和设备独立凭据。原隔离配置仍可供代码回退，但不作为日常用户流程。

`deploy/manage.py pair` 仅在管理员自己的终端生成一次性设备配对码，不输出长期 Token。Android、Windows 分别在插件照片设置输入各自的码。旧共享客户端 Token 不被正式模式接受，原 COS SDK 密钥仍在服务器原位置使用。

`deploy/manage.py pause` 暂停照片授权与 HEAD 网络操作；`rollback` 恢复运行配置和代码，不回滚主数据库、不删除照片或笔记。三个开关在正式模式长期 true，日常使用没有 15 分钟窗口。

每日元数据快照在原 stateDirectory/backups，最近 30 份。它是同机恢复保障，不是异地容灾。现有主机快照/异地备份仍需保留；恢复旧数据库快照后应撤销旧设备凭据并重新配对。

服务包不含凭据、照片、用户数据库、模拟 COS、前台演示服务器或测试数据。
`SDK_ADAPTER.md` 保留 SDK 接入阶段的边界说明，不代替本版生产审批单或部署状态。
